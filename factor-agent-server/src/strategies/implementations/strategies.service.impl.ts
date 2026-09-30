import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { normalizeWeights, BacktestService } from '../../core/backtest.service';
import { todayStr, CURVE_FLAT } from '../../core/store.service';
import { UserStoreService } from '../../core/user-store.service';
import { FactorWeight, Strategy } from '../../types';
import { BacktestParamsDto, CreateStrategyDto, UpdateStrategyDto } from '../dto';
import { StrategiesService } from '../strategies.service';

/* ==========================================================
   策略业务实现：草稿创建、保存=归一化+自动重新回测（API-10 语义）、报告详情组装
   M13：数据经 UserStoreService 按 userId 隔离（userId 来自 JWT，不信任入参）
   ========================================================== */

/** 股票池 → 默认业绩基准 */
const UNIVERSE_BENCH: [string, string][] = [
  ['中证1000', '中证1000指数'],
  ['中证800', '中证800成长'],
  ['沪深300', '沪深300指数'],
];

function defaultBenchmark(universe: string): string {
  const hit = UNIVERSE_BENCH.find(([key]) => universe.includes(key));
  return hit ? hit[1] : '沪深300指数';
}

@Injectable()
export class StrategiesServiceImpl extends StrategiesService {
  constructor(
    private readonly users: UserStoreService,
    private readonly backtestEngine: BacktestService,
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

  /** 更新配置并自动重新回测（契约：保存 = 重新回测，同一动作） */
  async update(userId: number, id: string, dto: UpdateStrategyDto): Promise<Strategy> {
    const strategy = await this.getOrThrow(userId, id);
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
