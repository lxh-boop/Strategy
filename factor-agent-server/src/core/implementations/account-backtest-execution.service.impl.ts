import { Inject, Injectable } from '@nestjs/common';
import {
  BacktestExecutionInput,
  BacktestExecutionOutput,
  BacktestExecutionService,
  DailyTotalPortfolioRow,
  TradeDetailRow,
} from '../backtest-execution.service';
import {
  StrategyBacktestInput,
  StrategyBacktestOutput,
  StrategyBacktestService,
} from '../strategy-backtest.service';

/**
 * 回测执行层 TS 实现：包装既有策略内核（模型 Ⅰ/Ⅱ 日频事件内核，Account 记账），
 * 把 StrategyBacktestOutput 映射为 dolp 形状输出。内核行为零改动——既有 146 用例基准继续有效。
 * 注意：card.trades 为卡片截断口径（最近 50 笔），tradeDetails 随之截断；
 * 引擎当前不产逐日持仓序列，dailyPositions 缺省（果仁 P0-1 落地后补）。
 */
@Injectable()
export class AccountBacktestExecutionService extends BacktestExecutionService {
  constructor(
    @Inject(StrategyBacktestService) private readonly strategy: StrategyBacktestService,
  ) {
    super();
  }

  async run(input: BacktestExecutionInput): Promise<BacktestExecutionOutput> {
    const out = await this.strategy.runStrategyBacktest(input.input, input.onProgress);
    return mapToExecutionOutput(out);
  }
}

/** StrategyBacktestOutput → dolp 形状；纯映射，指标口径沿用 RawMetrics 百分比 */
export function mapToExecutionOutput(out: StrategyBacktestOutput): BacktestExecutionOutput {
  const curve = out.card.curve;
  const base = curve[0];
  const totalReturn =
    curve.length > 0 && base > 0
      ? +(((curve[curve.length - 1] - base) / base) * 100).toFixed(2)
      : 0;
  const dailyTotalPortfolios: DailyTotalPortfolioRow[] = (out.card.dates ?? []).map(
    (tradeDate, i) => ({ tradeDate, netValue: curve[i] ?? base }),
  );
  const tradeDetails: TradeDetailRow[] = (out.card.trades ?? []).map((t) => ({
    symbol: t.code,
    direction: t.direction === 'buy' ? 1 : 3,
    tradeDate: t.date,
    tradePrice: t.price,
    tradeQty: t.shares,
    amount: t.amount,
    totalFee: t.fee,
    label: t.reason,
  }));
  return {
    returnSummary: {
      totalReturn,
      annualReturn: out.metrics.annual,
      maxDrawdown: out.metrics.drawdown,
      sharpeRatio: out.metrics.sharpe,
      winRate: out.metrics.winRate,
      turnoverRate: out.metrics.turnover,
    },
    dailyTotalPortfolios,
    tradeDetails,
  };
}
