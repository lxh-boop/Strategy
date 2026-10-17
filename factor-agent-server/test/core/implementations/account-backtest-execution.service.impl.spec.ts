import {
  AccountBacktestExecutionService,
  mapToExecutionOutput,
} from '../../../src/core/implementations/account-backtest-execution.service.impl';
import { StrategyBacktestOutput, StrategyBacktestService } from '../../../src/core/strategy-backtest.service';
import { BacktestCard } from '../../../src/types';

/* ==========================================================
   回测执行层 TS 实现（dolp 形状映射）单元测试：纯映射 + 透传，stub 不触库
   ========================================================== */

const baseOutput: StrategyBacktestOutput = {
  card: {
    type: 'backtest',
    title: '策略回测',
    tag: 'backtest',
    curve: [100, 105, 99],
    benchCurve: [100, 101, 102],
    metrics: [],
    dates: [20240102, 20240103, 20240104],
    trades: [
      { date: 20240103, code: '000001.XSHE', direction: 'buy', price: 10, shares: 1000, amount: 10000, fee: 3, reason: '调仓建仓' },
      { date: 20240104, code: '000002.XSHE', direction: 'sell', price: 9.9, shares: 500, amount: 4950, fee: 1.5, reason: '止损-5%' },
    ],
  } satisfies BacktestCard,
  summary: {},
  metrics: { annual: 12.3, drawdown: -5.1, sharpe: 1.2, winRate: 55, turnover: 350.5 },
};

describe('mapToExecutionOutput（StrategyBacktestOutput → dolp 形状映射）', () => {
  it('returnSummary 字段同名映射 + totalReturn 由净值曲线首尾计算', () => {
    const out = mapToExecutionOutput(baseOutput);
    expect(out.returnSummary).toEqual({
      totalReturn: -1, // (99-100)/100×100
      annualReturn: 12.3,
      maxDrawdown: -5.1,
      sharpeRatio: 1.2,
      winRate: 55,
      turnoverRate: 350.5,
    });
  });

  it('dailyTotalPortfolios 与 dates 对齐，netValue 取 curve 同下标', () => {
    const out = mapToExecutionOutput(baseOutput);
    expect(out.dailyTotalPortfolios).toEqual([
      { tradeDate: 20240102, netValue: 100 },
      { tradeDate: 20240103, netValue: 105 },
      { tradeDate: 20240104, netValue: 99 },
    ]);
  });

  it('tradeDetails：direction buy→1 / sell→3，label=触发原因，金额费用照搬', () => {
    const out = mapToExecutionOutput(baseOutput);
    expect(out.tradeDetails).toEqual([
      { symbol: '000001.XSHE', direction: 1, tradeDate: 20240103, tradePrice: 10, tradeQty: 1000, amount: 10000, totalFee: 3, label: '调仓建仓' },
      { symbol: '000002.XSHE', direction: 3, tradeDate: 20240104, tradePrice: 9.9, tradeQty: 500, amount: 4950, totalFee: 1.5, label: '止损-5%' },
    ]);
  });

  it('空曲线/无成交守护：totalReturn=0、明细空数组、dailyPositions 缺省', () => {
    const out = mapToExecutionOutput({
      card: { type: 'backtest', title: 't', tag: 'g', curve: [], benchCurve: [], metrics: [] },
      summary: {},
      metrics: { annual: 0, drawdown: 0, sharpe: 0, winRate: 0 },
    });
    expect(out.returnSummary.totalReturn).toBe(0);
    expect(out.dailyTotalPortfolios).toEqual([]);
    expect(out.tradeDetails).toEqual([]);
    expect(out.dailyPositions).toBeUndefined();
  });
});

describe('AccountBacktestExecutionService（包装既有内核，透传）', () => {
  it('run 透传原始入参与进度回调，返回 dolp 形状结果', async () => {
    const captured: { input: unknown; onProgress: unknown } = { input: null, onProgress: null };
    const strategy = {
      runStrategyBacktest: async (input: unknown, onProgress?: unknown) => {
        captured.input = input;
        captured.onProgress = onProgress;
        return baseOutput;
      },
    } as unknown as StrategyBacktestService;
    const svc = new AccountBacktestExecutionService(strategy);

    const onProgress = () => {};
    const out = await svc.run({
      input: { startDate: '20240101', endDate: '20240108', rebalanceIntervalDays: 2 },
      onProgress,
    });

    expect(captured.input).toEqual({ startDate: '20240101', endDate: '20240108', rebalanceIntervalDays: 2 });
    expect(captured.onProgress).toBe(onProgress);
    expect(out.tradeDetails).toHaveLength(2);
    expect(out.returnSummary.annualReturn).toBe(12.3);
  });
});
