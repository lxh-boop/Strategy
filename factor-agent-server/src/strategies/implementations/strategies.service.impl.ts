import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { normalizeWeights } from '../../core/metrics';
import {
  BENCHMARKS,
  BenchmarkKey,
  ClarificationSignal,
  assertStrategyInput,
  legacyConfigToInput,
  StrategyBacktestInput,
  StrategyBacktestService,
  collectFactorRefs,
} from '../../core/strategy-backtest.service';
import { todayStr } from '../../common/time';
import { UserStoreService } from '../../core/user-store.service';
import { BacktestRunConfig, FactorWeight, Strategy, StrategyRunConfig } from '../../types';
import { BacktestParamsDto, CreateFromBacktestDto, CreateStrategyDto, UpdateStrategyDto } from '../dto';
import { StrategiesService } from '../strategies.service';

/* ==========================================================
   策略业务实现：策略唯一的出生地是对话（回测卡片 API-27 保存，带可复现配置）
   M13：数据经 UserStoreService 按 userId 隔离（userId 来自 JWT，不信任入参）
   回测统一走策略回测引擎（日频事件内核）：
   - 新卡片 config（StrategyRunConfig）直接重跑；
   - 历史等权卡片 config（BacktestRunConfig）经 legacyConfigToInput 适配后重跑；
   - 无 backtestConfig 的旧版草稿为历史演示数据：仅支持查看（重跑/改配置均 400）。
   ========================================================== */

/** 旧等权配置的频率标签（展示用；新配置直接按 rebalanceIntervalDays 展示） */
const LEGACY_FREQUENCY_LABELS: Record<string, string> = {
  daily: '每日',
  weekly: '每周',
  biweekly: '每半月',
  monthly: '每月',
  quarterly: '每季',
  semiannual: '每半年',
  annual: '每年',
  custom: '自定义',
};

/** 卡片 config → 引擎入参：新 StrategyRunConfig 直接用；旧 BacktestRunConfig 走适配 */
function toStrategyInput(config: BacktestRunConfig | StrategyRunConfig): StrategyBacktestInput {
  if ('rebalanceIntervalDays' in config) return config as StrategyRunConfig;
  return legacyConfigToInput(config as BacktestRunConfig);
}

/** 调仓方式展示标签（两种 config 统一口径） */
function rebalanceLabel(config: BacktestRunConfig | StrategyRunConfig): string {
  if ('rebalanceIntervalDays' in config) return `每${config.rebalanceIntervalDays}个交易日调仓`;
  const legacy = config as BacktestRunConfig;
  return (
    LEGACY_FREQUENCY_LABELS[legacy.frequency] +
    (legacy.frequency === 'custom' && legacy.everyNTd ? `·每${legacy.everyNTd}交易日` : '') +
    '调仓'
  );
}

/** 因子展示权重（等权折算仅作展示） */
function factorWeights(config: BacktestRunConfig | StrategyRunConfig): FactorWeight[] {
  if ('sortFactors' in config) {
    return normalizeWeights(
      (config as StrategyRunConfig).sortFactors?.map((f) => ({
        name: `${f.field}${f.direction === -1 ? '(小值优)' : '(大值优)'}`,
        weight: 1,
      })) ?? [],
    );
  }
  return normalizeWeights(
    (config as BacktestRunConfig).factors.map((f) => ({
      name: `${f.field}${f.order === 'asc' ? '(小值优)' : '(大值优)'}`,
      weight: 1,
    })),
  );
}

@Injectable()
export class StrategiesServiceImpl extends StrategiesService {
  private readonly logger = new Logger(StrategiesService.name);
  constructor(
    private readonly users: UserStoreService,
    private readonly strategyBacktest: StrategyBacktestService,
  ) {
    super();
  }

  async list(userId: number): Promise<Strategy[]> {
    return this.users.listStrategies(userId);
  }

  /** 草稿创建已下线：策略唯一的出生地是对话——完成回测后经 API-27 保存（带可复现配置） */
  async create(_userId: number, _dto: CreateStrategyDto): Promise<Strategy> {
    throw new ApiException(
      'INVALID_ARGUMENT',
      400,
      '策略请在对话中创建：与智能体完成回测后，在回测卡片上点「保存为我的策略」',
    );
  }

  /** API-27：由回测卡片配置创建策略——服务端按同一配置重跑策略回测真引擎，
   *  曲线/指标与卡片一致（同数据同配置确定性复现）。因子权重按等权折算仅作展示。 */
  async createFromBacktest(userId: number, dto: CreateFromBacktestDto): Promise<Strategy> {
    const config = dto.config as unknown as BacktestRunConfig | StrategyRunConfig;
    let input: StrategyBacktestInput;
    try {
      input = toStrategyInput(config);
    } catch (error) {
      // 引擎的澄清信号（面向模型追问）在 API 面转 400，给出可操作的缺参消息
      if (error instanceof ClarificationSignal) {
        throw new ApiException('INVALID_ARGUMENT', 400, `回测配置不完整：${(error.guide as { 需要澄清?: string }).需要澄清 ?? '缺少必要参数'}`);
      }
      throw error;
    }
    const out = await this.strategyBacktest.runStrategyBacktest(input);
    const strategy: Strategy = {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: dto.name,
      status: 'done',
      universe: '全市场（因子表覆盖）',
      rebalance: rebalanceLabel(config),
      benchmark: BENCHMARKS[(input.benchmark ?? 'hs300') as BenchmarkKey].name,
      updatedAt: todayStr(),
      factors: factorWeights(config),
      metrics: out.metrics,
      curve: out.card.curve,
      benchCurve: out.card.benchCurve,
      dates: out.card.dates,
      // 引擎产出的参数口径与逐期/逐笔明细：详情页「回测参数/最新一期持仓/历史持仓/历史交易」数据源
      params: out.card.params ?? [],
      periodHoldings: out.card.periodHoldings ?? [],
      trades: out.card.trades ?? [],
      holdings: [], // 旧版演示持仓字段，真引擎策略固定为空
      backtestConfig: config,
    };
    await this.users.saveStrategy(userId, strategy);
    // 因子使用统计（后台计数，失败不挡保存）：常用因子画像的频次来源
    void this.users.incrementFactorUsage(userId, collectFactorRefs(assertStrategyInput(input))).catch((e) =>
      this.logger.warn(`因子使用统计失败 用户=${userId}: ${String(e)}`),
    );
    return strategy;
  }

  /** 更新配置并自动重新回测（契约：保存 = 重新回测，同一动作）。
   *  旧版草稿（无 backtestConfig）仅支持查看：任何更新都 400 打回。 */
  async update(userId: number, id: string, dto: UpdateStrategyDto): Promise<Strategy> {
    const strategy = await this.getOrThrow(userId, id);
    if (!strategy.backtestConfig) {
      throw new ApiException(
        'INVALID_ARGUMENT', 400,
        '旧版草稿策略仅支持查看，请在对话中重新创建策略',
      );
    }
    const cfg = dto.factors !== undefined || dto.universe !== undefined ||
      dto.rebalance !== undefined || dto.benchmark !== undefined;
    if (cfg) {
      throw new ApiException(
        'INVALID_ARGUMENT', 400,
        '该策略由回测卡片生成（因子等权合成，权重不可调）；如需调整因子请在对话中重新回测后再保存',
      );
    }
    if (dto.name !== undefined) strategy.name = dto.name;
    return this.runBacktest(userId, strategy, {});
  }

  async remove(userId: number, id: string): Promise<void> {
    if (!(await this.users.deleteStrategy(userId, id))) {
      throw new ApiException('NOT_FOUND', 404, `策略不存在: ${id}`);
    }
  }

  async backtest(userId: number, id: string, params: BacktestParamsDto): Promise<Strategy> {
    const strategy = await this.getOrThrow(userId, id);
    return this.runBacktest(userId, strategy, params);
  }

  async getReport(userId: number, id: string): Promise<Pick<Strategy, 'metrics' | 'curve' | 'benchCurve' | 'holdings'>> {
    const s = await this.getOrThrow(userId, id);
    return { metrics: s.metrics, curve: s.curve, benchCurve: s.benchCurve, holdings: s.holdings };
  }

  /** 执行回测并写回策略。无 backtestConfig 的旧版草稿是历史演示数据：不支持重跑。 */
  private async runBacktest(userId: number, strategy: Strategy, _params: BacktestParamsDto): Promise<Strategy> {
    if (!strategy.backtestConfig) {
      throw new ApiException(
        'INVALID_ARGUMENT', 400,
        '旧版策略不支持重跑回测，请在对话中重新创建策略',
      );
    }
    /* 由回测卡片生成的策略：重跑策略回测真引擎（按存储的可复现配置） */
    const out = await this.strategyBacktest.runStrategyBacktest(toStrategyInput(strategy.backtestConfig));
    strategy.curve = out.card.curve;
    strategy.benchCurve = out.card.benchCurve;
    strategy.dates = out.card.dates;
    strategy.metrics = out.metrics;
    strategy.params = out.card.params ?? [];
    strategy.periodHoldings = out.card.periodHoldings ?? [];
    strategy.trades = out.card.trades ?? [];
    if (strategy.status === 'draft') strategy.status = 'done';
    strategy.updatedAt = todayStr();
    await this.users.saveStrategy(userId, strategy);
    // 重跑保存同样是"还在用这些因子"的信号：后台计数（失败不挡）
    void this.users.incrementFactorUsage(userId, collectFactorRefs(assertStrategyInput(toStrategyInput(strategy.backtestConfig)))).catch((e) =>
      this.logger.warn(`因子使用统计失败 用户=${userId}: ${String(e)}`),
    );
    return strategy;
  }

  private async getOrThrow(userId: number, id: string): Promise<Strategy> {
    const strategy = await this.users.getStrategy(userId, id);
    if (!strategy) throw new ApiException('NOT_FOUND', 404, `策略不存在: ${id}`);
    return strategy;
  }
}
