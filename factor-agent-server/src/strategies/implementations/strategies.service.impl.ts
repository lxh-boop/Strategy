import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { normalizeWeights, BacktestService } from '../../core/backtest.service';
import { todayStr, StoreService, CURVE_FLAT } from '../../core/store.service';
import { FactorWeight, Strategy } from '../../types';
import { BacktestParamsDto, CreateStrategyDto, UpdateStrategyDto } from '../dto';
import { StrategiesService } from '../strategies.service';

/* ==========================================================
   策略业务实现：草稿创建、保存=归一化+自动重新回测（API-10 语义）、报告详情组装
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
    private readonly store: StoreService,
    private readonly backtestEngine: BacktestService,
  ) {
    super();
  }

  list(): Strategy[] {
    return this.store.listStrategies();
  }

  create(dto: CreateStrategyDto): Strategy {
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
    this.store.saveStrategy(strategy);
    return strategy;
  }

  /** 更新配置并自动重新回测（契约：保存 = 重新回测，同一动作） */
  update(id: string, dto: UpdateStrategyDto): Strategy {
    const strategy = this.getOrThrow(id);
    if (dto.name !== undefined) strategy.name = dto.name;
    if (dto.universe !== undefined) strategy.universe = dto.universe;
    if (dto.rebalance !== undefined) strategy.rebalance = dto.rebalance;
    if (dto.benchmark !== undefined) strategy.benchmark = dto.benchmark;
    if (dto.factors !== undefined) strategy.factors = this.normalizeOrThrow(dto.factors);
    return this.runBacktest(strategy, {});
  }

  remove(id: string): void {
    if (!this.store.deleteStrategy(id)) {
      throw new ApiException('NOT_FOUND', 404, `策略不存在: ${id}`);
    }
  }

  backtest(id: string, params: BacktestParamsDto): Strategy {
    const strategy = this.getOrThrow(id);
    return this.runBacktest(strategy, params);
  }

  getReport(id: string): Pick<Strategy, 'metrics' | 'curve' | 'benchCurve' | 'holdings'> {
    const s = this.getOrThrow(id);
    return { metrics: s.metrics, curve: s.curve, benchCurve: s.benchCurve, holdings: s.holdings };
  }

  /** 执行回测并写回策略（草稿回测完成后状态变为 done，其余保持原状态） */
  private runBacktest(strategy: Strategy, params: BacktestParamsDto): Strategy {
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

    this.store.saveStrategy(strategy);
    return strategy;
  }

  private normalizeOrThrow(factors: FactorWeight[]): FactorWeight[] {
    const normalized = normalizeWeights(factors);
    if (normalized.every((f) => f.weight === 0)) {
      throw new ApiException('INVALID_ARGUMENT', 400, '因子权重合计为 0，属非法输入');
    }
    return normalized;
  }

  private getOrThrow(id: string): Strategy {
    const strategy = this.store.getStrategy(id);
    if (!strategy) throw new ApiException('NOT_FOUND', 404, `策略不存在: ${id}`);
    return strategy;
  }
}
