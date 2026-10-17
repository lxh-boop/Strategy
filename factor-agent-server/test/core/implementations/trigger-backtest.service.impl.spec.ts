import { FactorDataService, QuoteRow } from '../../../src/core/factor-data.service';
import { TriggerBacktestServiceImpl } from '../../../src/core/implementations/trigger-backtest.service.impl';
import { NormalizedStrategyInput } from '../../../src/core/strategy-backtest.service';

/* ----- 触发引擎 stub 测试（不触库）：模型 Ⅱ 条件触发 ----- */

const TRADE_DATES = [20240102, 20240103, 20240104, 20240105];
const CODE_A = '000001.XSHE';

function quoteRow(date: number, q: { o: number; c: number; pc: number }): QuoteRow {
  const s = String(date);
  return {
    ticker: '000001',
    exchange: 'XSHE',
    tradeDate: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
    open: q.o,
    close: q.c,
    preClose: q.pc,
  };
}

/** A 的价格路径：10 → 10.5 → 20 → 20（D2 大涨制造仓位偏离） */
function quotes(): QuoteRow[] {
  return [
    quoteRow(20240102, { o: 10, c: 10, pc: 10 }),
    quoteRow(20240103, { o: 10, c: 10.5, pc: 10 }),
    quoteRow(20240104, { o: 20, c: 20, pc: 10.5 }),
    quoteRow(20240105, { o: 20, c: 20, pc: 20 }),
  ];
}

/** 触发域 fixture：仅 20240102 当日 RSI<30 触发（A） */
function makeService(sections: Record<number, Record<string, number>>, quoteList: QuoteRow[]): TriggerBacktestServiceImpl {
  const factorData = {
    readTable: async () => [],
    readTradeDates: async () => ({ dates: TRADE_DATES, min: 20200101, max: 20241231 }),
    readFactorSection: async (_table: string, _field: string, date: string) => {
      const section = sections[Number(date)] ?? {};
      return Object.entries(section).map(([securityId, value]) => ({ securityId, value }));
    },
    readFactorRange: async () => [],
    readQuoteSeries: async () => quoteList,
    readIndexDaily: async () => [
      { tradeDate: '2024-01-02', close: 100, preClose: 100 },
      { tradeDate: '2024-01-03', close: 101, preClose: 100 },
      { tradeDate: '2024-01-04', close: 102, preClose: 101 },
      { tradeDate: '2024-01-05', close: 102, preClose: 102 },
    ],
    readIndexFieldSeries: async () => [],
  } as unknown as FactorDataService;
  return new TriggerBacktestServiceImpl(factorData);
}

/** 触发模式归一化入参（绕过 assertStrategyInput 直构，字段与归一化形态一致） */
function triggerInput(overrides: Partial<NormalizedStrategyInput> = {}): NormalizedStrategyInput {
  return {
    securityIds: [CODE_A],
    startDate: '20240101',
    endDate: '20240108',
    initialCapital: 100_000,
    feeRate: 0,
    rebalanceIntervalDays: 0,
    positionDeviatePct: 10,
    executionTiming: 0,
    maxPositions: 1,
    idealPositionPct: 50,
    minPositionPct: 1,
    entryFilters: [{ table: 'equ_factor_obos', field: 'RSI', op: '<', value: 30 }],
    sortFactors: [],
    sellRules: [],
    keepRules: [],
    excludeRanges: [],
    benchmark: 'hs300',
    strategyType: 'equal_weight',
    ...overrides,
  };
}

describe('TriggerBacktestServiceImpl（模型 Ⅱ 条件触发，全流程 stub）', () => {
  it('触发买入：D0 条件满足 → D1 开盘触发建仓（T+1 语义）', async () => {
    const service = makeService({ 20240102: { [CODE_A]: 10 } }, quotes());
    const out = await service.run(triggerInput({ positionDeviatePct: 50 }));
    const trades = out.card.trades ?? [];
    expect(trades.map((t) => [t.date, t.direction, t.reason])).toEqual([[20240103, 'buy', '触发建仓']]);
    // 目标市值 = 10 万权益 × 50%（idealPositionPct）× 100%（无择时暴露）= 5 万 → 5000 股 @10
    expect(trades[0].shares).toBe(5000);
    // 未启用择时：无仓位分布三件套
    expect(out.card.positionDist).toBeUndefined();
    // 每期持仓明细：触发模式按 5 交易日切期（4 天区间 = 单期），期末收盘快照
    expect(out.card.periodHoldings).toEqual([
      { seq: 1, startDate: 20240102, endDate: 20240105, holdings: [
        { code: CODE_A, shares: 5000, closePrice: 20, entryPrice: 10, periodReturnPct: 100, weightPct: 100 },
      ] },
    ]);
    expect(out.card.latestOrders?.map((t) => t.direction)).toEqual(['buy']);
    expect(out.card.recentSold ?? []).toEqual([]);
  });

  it('最小建仓仓位：目标市值低于权益×minPositionPct% → 跳过候选不建碎仓（与模型 Ⅰ 同口径）', async () => {
    const service = makeService({ 20240102: { [CODE_A]: 10 } }, quotes());
    const out = await service.run(triggerInput({ idealPositionPct: 10, minPositionPct: 30, positionDeviatePct: 50 }));
    // 目标市值 = 10 万 × 10% = 1 万 < 下限 3 万 → 不建仓
    expect(out.card.trades ?? []).toHaveLength(0);
  });

  it('最小建仓仓位边界：目标市值恰等于下限 → 正常建仓', async () => {
    const service = makeService({ 20240102: { [CODE_A]: 10 } }, quotes());
    const out = await service.run(triggerInput({ idealPositionPct: 50, minPositionPct: 50, positionDeviatePct: 50 }));
    expect(out.card.trades ?? []).toHaveLength(1);
  });

  it('仓位偏离带：大涨使持仓占比超带宽 → 按目标比例偏离带减仓', async () => {
    const service = makeService({ 20240102: { [CODE_A]: 10 } }, quotes());
    const out = await service.run(triggerInput());
    const trades = out.card.trades ?? [];
    // D2 收盘 20：持仓市值 10 万 / 权益 15 万 = 66.7%，偏离目标 50% 达 16.7% > 带宽 10%
    // → 目标市值 7.5 万，需减 2.5 万 ÷ 20 元 = 1250 股 → 整手 1200 股
    expect(trades.map((t) => [t.date, t.direction, t.reason])).toEqual([
      [20240103, 'buy', '触发建仓'],
      [20240104, 'sell', '偏离带减仓'],
    ]);
    expect(trades[1].shares).toBe(1200);
    // D3 无偏离 → 无再平衡
  });

  it('护栏：未声明触发域（全市场）→ 报错', async () => {
    const service = makeService({ 20240102: { [CODE_A]: 10 } }, quotes());
    const input = triggerInput();
    input.securityIds = null;
    await expect(service.run(input)).rejects.toThrow(/触发域/);
  });

  it('护栏：无买入触发条件 → 报错', async () => {
    const service = makeService({}, quotes());
    const input = triggerInput();
    input.entryFilters = [];
    await expect(service.run(input)).rejects.toThrow(/entryFilters/);
  });

  it('护栏：field/rank_out 卖出规则不支持 → 报错', async () => {
    const service = makeService({}, quotes());
    const input = triggerInput();
    input.sellRules = [{ kind: 'field', table: 'equ_factor_obos', field: 'RSI', op: '<', value: 20 }];
    await expect(service.run(input)).rejects.toThrow(/field（字段条件）与 rank_out/);
  });
});
