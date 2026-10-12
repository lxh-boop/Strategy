import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { normalizeWeights, BacktestService } from '../../core/backtest.service';
import {
  BENCHMARKS,
  BenchmarkKey,
  legacyConfigToInput,
  StrategyBacktestInput,
  StrategyBacktestService,
} from '../../core/strategy-backtest.service';
import { todayStr, CURVE_FLAT } from '../../core/store.service';
import { UserStoreService } from '../../core/user-store.service';
import { BacktestRunConfig, FactorWeight, Strategy, StrategyRunConfig } from '../../types';
import { BacktestParamsDto, CreateFromBacktestDto, CreateStrategyDto, UpdateStrategyDto } from '../dto';
import { StrategiesService } from '../strategies.service';

/* ==========================================================
   策略业务实现：草稿创建、保存=归一化+自动重新回测（API-10 语义）、报告详情组装
   M13：数据经 UserStoreService 按 userId 隔离（userId 来自 JWT，不信任入参）
   回测统一走策略回测引擎（日频事件内核）：
   - 新卡片 config（StrategyRunConfig）直接重跑；
   - 历史等权卡片 config（BacktestRunConfig）经 legacyConfigToInput 适配后重跑。
   ========================================================== */

/** 股票池 → 默认业绩基准 */
const UNIVERSE_BENCH: [string, string][] = [
  ['中证1000', '中证1000指数'],
  ['中证800', '中证800成长'],
  ['沪深300', '沪深300指数'],
];

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

function defaultBenchmark(universe: string): string {
  const hit = UNIVERSE_BENCH.find(([key]) => universe.includes(key));
  return hit ? hit[1] : '沪深300指数';
}

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
  constructor(
    private readonly users: UserStoreService,
    private readonly backtestEngine: BacktestService,
    private readonly strategyBacktest: StrategyBacktestService,
  ) {
    super();
  }

  async list(userId: number): Promise<Strategy[]> {
    return this.users.listStrategies(userId);
  }

  async create(userId: number, dto: CreateStrategyDto): Promise<Strategy> {
    const universe = dto.universe ?? '沪深300 + 中证500';
    const strategy: Strategy = {
      id: 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: dto.name,
      status: 'draft',
      universe,
      rebalance: dto.rebalance ?? '每月调仓',
      benchmark: dto.benchmark ?? defaultBenchmark(universe),
      updatedAt: todayStr(),
      factors: this.normalizeOrThrow(dto.factors),
      metrics: null,
      curve: CURVE_FLAT,
      benchCurve: CURVE_FLAT,
      holdings: [],
    };
    await this.users.saveStrategy(userId, strategy);
    return strategy;
  }

  /** API-27：由回测卡片配置创建策略——服务端按同一配置重跑策略回测真引擎，
   *  曲线/指标与卡片一致（同数据同配置确定性复现）。因子权重按等权折算仅作展示。 */
  async createFromBacktest(userId: number, dto: CreateFromBacktestDto): Promise<Strategy> {
    const config = dto.config as BacktestRunConfig | StrategyRunConfig;
    const input = toStrategyInput(config);
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
      holdings: [], // 策略回测引擎暂不产出持仓明细，详情页展示口径见前端
      backtestConfig: config,
    };
    await this.users.saveStrategy(userId, strategy);
    return strategy;
  }

  /** 更新配置并自动重新回测（契约：保存 = 重新回测，同一动作） */
  async update(userId: number, id: string, dto: UpdateStrategyDto): Promise<Strategy> {
    const strategy = await this.getOrThrow(userId, id);
    if (strategy.backtestConfig) {
      const cfg = dto.factors !== undefined || dto.universe !== undefined ||
        dto.rebalance !== undefined || dto.benchmark !== undefined;
      if (cfg) {
        throw new ApiException(
          'INVALID_ARGUMENT', 400,
          '该策略由回测卡片生成（因子等权合成，权重不可调）；如需调整因子请在对话中重新回测后再保存',
        );
      }
    }
    if (dto.name !== undefined) strategy.name = dto.name;
    if (dto.universe !== undefined) strategy.universe = dto.universe;
    if (dto.rebalance !== undefined) strategy.rebalance = dto.rebalance;
    if (dto.benchmark !== undefined) strategy.benchmark = dto.benchmark;
    if (dto.factors !== undefined) strategy.factors = this.normalizeOrThrow(dto.factors);
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

  /** 执行回测并写回策略（草稿回测完成后状态变为 done，其余保持原状态） */
  private async runBacktest(userId: number, strategy: Strategy, params: BacktestParamsDto): Promise<Strategy> {
    /* 由回测卡片生成的策略：重跑策略回测真引擎（按存储的可复现配置），不走 mock */
    if (strategy.backtestConfig) {
      const out = await this.strategyBacktest.runStrategyBacktest(toStrategyInput(strategy.backtestConfig));
      strategy.curve = out.card.curve;
      strategy.benchCurve = out.card.benchCurve;
      strategy.dates = out.card.dates;
      strategy.metrics = out.metrics;
      if (strategy.status === 'draft') strategy.status = 'done';
      strategy.updatedAt = todayStr();
      await this.users.saveStrategy(userId, strategy);
      return strategy;
    }
    const bt = this.backtestEngine.runBacktest({
      seedKey: `${strategy.id}|${strategy.universe}|${strategy.rebalance}|${JSON.stringify(strategy.factors)}`,
      factors: strategy.factors,
      universe: strategy.universe,
      rebalance: strategy.rebalance,
      holdingsCount: params.topK ? Math.min(params.topK, 10) : 10,
    });

    strategy.curve = bt.curve;
    strategy.benchCurve = bt.benchCurve;
    strategy.metrics = bt.metrics;
    strategy.holdings = bt.holdings;
    if (strategy.status === 'draft') strategy.status = 'done';
    strategy.updatedAt = todayStr();

    await this.users.saveStrategy(userId, strategy);
    return strategy;
  }

  private normalizeOrThrow(factors: FactorWeight[]): FactorWeight[] {
    const normalized = normalizeWeights(factors);
    if (normalized.every((f) => f.weight === 0)) {
      throw new ApiException('INVALID_ARGUMENT', 400, '因子权重合计为 0，属非法输入');
    }
    return normalized;
  }

  private async getOrThrow(userId: number, id: string): Promise<Strategy> {
    const strategy = await this.users.getStrategy(userId, id);
    if (!strategy) throw new ApiException('NOT_FOUND', 404, `策略不存在: ${id}`);
    return strategy;
  }
}
