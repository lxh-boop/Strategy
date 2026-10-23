import { FactorDataService, QuoteRow } from '../../src/core/factor-data.service';
import { StrategyBacktestServiceImpl } from '../../src/core/implementations/strategy-backtest.service.impl';
import { assertStrategyInput, type StrategyBacktestInput } from '../../src/core/strategy-backtest.service';

/* ==========================================================
   仓位维持与涨跌停顺延专项测试（ADR-0008）：全流程 stub 不触库。
   默认值 = 掘金对齐语义：keepFullyInvested=false（卖出现金保留至下一调仓日）、
   limitUpDownSkip=false（涨跌停价照常成交）。
   ========================================================== */

const TRADE_DATES = [20240102, 20240103, 20240104, 20240105];
const CODE_A = '000001.XSHE';
const CODE_B = '000002.XSHE';

const base: StrategyBacktestInput = {
  startDate: '20240101',
  endDate: '20240131',
  rebalanceIntervalDays: 21,
  maxPositions: 1,
};

function quotesFor(ticker: string, rows: [number, { o: number; c: number; pc: number }][]): QuoteRow[] {
  return rows.map(([date, q]) => ({
    ticker: ticker.slice(0, 6),
    exchange: 'XSHE',
    tradeDate: `${String(date).slice(0, 4)}-${String(date).slice(4, 6)}-${String(date).slice(6, 8)}`,
    open: q.o,
    close: q.c,
    preClose: q.pc,
  }));
}

interface Fixture {
  /** 按字段的日截面："REVS20"|"BIAS20" → 日期 → (code → 值) */
  revs20: Record<number, Record<string, number>>;
  bias20: Record<number, Record<string, number>>;
  quotes: QuoteRow[];
  /** field 类卖出规则的区间序列（readFactorRange 通道） */
  factorRanges?: Record<string, { securityId: string; tradeDate: string; value: number }[]>;
}

/** 行情：A 平稳（10 附近），B 缓涨（20 → 21）；涨停/跌停场景由用例自行覆盖价格 */
function makeService(fixture: Fixture): StrategyBacktestServiceImpl {
  const factorData = {
    readTable: async () => [],
    readTradeDates: async () => ({ dates: TRADE_DATES, min: 20200101, max: 20241231 }),
    readFactorSection: async (_table: string, field: string, date: string) => {
      const section = field === 'REVS20' ? fixture.revs20[Number(date)] : fixture.bias20[Number(date)];
      return Object.entries(section ?? {}).map(([securityId, value]) => ({ securityId, value }));
    },
    readFactorRange: async (table: string, field: string) => fixture.factorRanges?.[`${table}.${field}`] ?? [],
    readQuoteSeries: async () => fixture.quotes,
    readIndexDaily: async () => [
      { tradeDate: '2024-01-02', close: 100, preClose: 100 },
      { tradeDate: '2024-01-03', close: 101, preClose: 100 },
      { tradeDate: '2024-01-04', close: 102, preClose: 101 },
      { tradeDate: '2024-01-05', close: 102, preClose: 102 },
    ],
    readIndexFieldSeries: async () => [],
  } as unknown as FactorDataService;
  return new StrategyBacktestServiceImpl(factorData);
}

describe('仓位维持 keepFullyInvested（ADR-0008：默认 false = 掘金对齐语义）', () => {
  /** 两只票 50/50 建仓；次日起 A 的 BIAS20<0 触发卖出：
   *  false（默认）→ 现金保留、B 份额不变；true → 当日择时加仓回补 B（择时加仓 trade） */
  function fixture(biasA: number): Fixture {
    return {
      revs20: {
        20240102: { [CODE_A]: 1.5, [CODE_B]: 1.2 },
        20240103: { [CODE_A]: 1.5, [CODE_B]: 1.2 },
        20240104: { [CODE_A]: 1.5, [CODE_B]: 1.2 },
        20240105: { [CODE_A]: 1.5, [CODE_B]: 1.2 },
      },
      bias20: {
        20240102: { [CODE_A]: 1.0, [CODE_B]: 1.0 },
        20240103: { [CODE_A]: biasA, [CODE_B]: 1.0 },
        20240104: { [CODE_A]: biasA, [CODE_B]: 1.0 },
        20240105: { [CODE_A]: biasA, [CODE_B]: 1.0 },
      },
      quotes: [
        ...quotesFor(CODE_A, [
          [20240102, { o: 10, c: 10, pc: 10 }],
          [20240103, { o: 10, c: 10, pc: 10 }],
          [20240104, { o: 9.9, c: 9.9, pc: 10 }],
          [20240105, { o: 9.9, c: 9.9, pc: 9.9 }],
        ]),
        ...quotesFor(CODE_B, [
          [20240102, { o: 20, c: 20, pc: 20 }],
          [20240103, { o: 20, c: 20, pc: 20 }],
          [20240104, { o: 20, c: 20.5, pc: 20 }],
          [20240105, { o: 20.5, c: 21, pc: 20.5 }],
        ]),
      ],
      factorRanges: {
        'equ_factor_obos.BIAS20': [
          { securityId: CODE_A, tradeDate: '2024-01-03', value: biasA },
          { securityId: CODE_A, tradeDate: '2024-01-04', value: biasA },
          { securityId: CODE_A, tradeDate: '2024-01-05', value: biasA },
          { securityId: CODE_B, tradeDate: '2024-01-03', value: 1 },
          { securityId: CODE_B, tradeDate: '2024-01-04', value: 1 },
          { securityId: CODE_B, tradeDate: '2024-01-05', value: 1 },
        ],
      },
    };
  }

  it('缺省 false：BIAS20 卖出的现金保留（无择时加仓），B 份额不变', async () => {
    const svc = makeService(fixture(-2));
    const out = await svc.runStrategyBacktest(
      assertStrategyInput({
        ...base,
        maxPositions: 2,
        idealPositionPct: 50,
        sellRules: [{ kind: 'field', table: 'equ_factor_obos', field: 'BIAS20', op: '<', value: 0 }],
      }),
    );
    expect((out.card.trades ?? []).filter((t) => t.reason === '择时加仓')).toHaveLength(0);
    // B 只在调仓建仓时买入一次，卖 A 后未被回补
    const bBuys = (out.card.trades ?? []).filter((t) => t.code === CODE_B && t.direction === 'buy');
    expect(bBuys).toHaveLength(1);
  });

  it('keepFullyInvested=true：卖 A 当日按市值占比择时加仓 B（保持满仓）', async () => {
    const svc = makeService(fixture(-2));
    const out = await svc.runStrategyBacktest(
      assertStrategyInput({
        ...base,
        maxPositions: 2,
        idealPositionPct: 50,
        keepFullyInvested: true,
        sellRules: [{ kind: 'field', table: 'equ_factor_obos', field: 'BIAS20', op: '<', value: 0 }],
      }),
    );
    const adds = (out.card.trades ?? []).filter((t) => t.reason === '择时加仓');
    expect(adds.length).toBeGreaterThanOrEqual(1);
    expect(adds.every((t) => t.code === CODE_B)).toBe(true);
  });
});

describe('涨跌停判定 limitUpDownSkip（ADR-0009：缺省 true=开启，官方分档价随行情行注入）', () => {
  const limitUpFixture = (): Fixture => ({
    revs20: {
      20240102: { [CODE_A]: 1.5 },
      20240103: { [CODE_A]: 1.5 },
      20240104: { [CODE_A]: 1.5 },
      20240105: { [CODE_A]: 1.5 },
    },
    bias20: {
      20240102: { [CODE_A]: 1.0 },
      20240103: { [CODE_A]: 1.0 },
      20240104: { [CODE_A]: 1.0 },
      20240105: { [CODE_A]: 1.0 },
    },
    quotes: quotesFor(CODE_A, [
      [20240102, { o: 10, c: 10, pc: 10 }],
      [20240103, { o: 11.1, c: 11.1, pc: 10 }], // 开盘即官方涨停价（limitUp=11.1，触及不成交）
      [20240104, { o: 11.1, c: 11.1, pc: 11.1 }],
      [20240105, { o: 11.1, c: 11.1, pc: 11.1 }],
    ]).map((r) => (r.tradeDate === '2024-01-03' ? { ...r, limitUp: 11.1, limitDown: 9 } : r)),
  });

  it('缺省 true：触及官方涨停价不追（跳过该候选）', async () => {
    const svc = makeService(limitUpFixture());
    const out = await svc.runStrategyBacktest(assertStrategyInput(base));
    expect((out.card.trades ?? []).filter((t) => t.reason === '调仓建仓')).toHaveLength(0);
  });

  it('limitUpDownSkip=false（对照模式）：涨停价照常成交', async () => {
    const svc = makeService(limitUpFixture());
    const out = await svc.runStrategyBacktest(assertStrategyInput({ ...base, limitUpDownSkip: false }));
    expect((out.card.trades ?? []).filter((t) => t.reason === '调仓建仓')).toHaveLength(1);
  });

  it('官方价缺行降级：开关开启但行情行无 limitUp → 照常成交并计数', async () => {
    const svc = makeService(limitUpFixture());
    const out = await svc.runStrategyBacktest(assertStrategyInput(base));
    // 上面同款面板已含官方价——这里构造无官方价版本验证降级
    const noLimitFixture = limitUpFixture();
    noLimitFixture.quotes = noLimitFixture.quotes.map((r) => ({ ...r, limitUp: null, limitDown: null }));
    const svc2 = makeService(noLimitFixture);
    const out2 = await svc2.runStrategyBacktest(assertStrategyInput(base));
    expect((out2.card.trades ?? []).filter((t) => t.reason === '调仓建仓')).toHaveLength(1);
  });
});

describe('executionTiming=2（尾盘单：信号日当日收盘成交，掘金对齐）', () => {
  const cfg = (extra: Partial<StrategyBacktestInput> = {}): StrategyBacktestInput => ({
    ...base,
    ...extra,
  });

  it('首期建仓发生在信号日当日（20240102 收盘），而非次日开盘', async () => {
    const svc = makeService({
      revs20: {
        20240102: { [CODE_A]: 1.5, [CODE_B]: 1.2 },
      },
      bias20: {
        20240102: { [CODE_A]: 1.0, [CODE_B]: 1.0 },
      },
      quotes: [
        ...quotesFor(CODE_A, [
          [20240102, { o: 10, c: 10, pc: 10 }],
          [20240103, { o: 10, c: 10, pc: 10 }],
        ]),
        ...quotesFor(CODE_B, [
          [20240102, { o: 20, c: 20, pc: 20 }],
          [20240103, { o: 20, c: 20, pc: 20 }],
        ]),
      ],
    });
    const out = await svc.runStrategyBacktest(
      assertStrategyInput(cfg({ executionTiming: 2, maxPositions: 2, idealPositionPct: 50 })),
    );
    const buys = (out.card.trades ?? []).filter((t) => t.direction === 'buy');
    expect(buys.length).toBe(2);
    expect(buys.every((t) => t.date === 20240102)).toBe(true); // 当日收盘成交（mode 0/1 为 20240103）
  });

  it('BIAS20<0 卖出在信号日当日收盘成交（尾盘单），而非次日', async () => {
    const svc = makeService({
      revs20: {
        20240102: { [CODE_A]: 1.5, [CODE_B]: 1.2 },
        20240103: { [CODE_A]: 1.5, [CODE_B]: 1.2 },
      },
      bias20: {
        20240102: { [CODE_A]: 1.0, [CODE_B]: 1.0 },
        20240103: { [CODE_A]: -2.0, [CODE_B]: 1.0 },
      },
      quotes: [
        ...quotesFor(CODE_A, [
          [20240102, { o: 10, c: 10, pc: 10 }],
          [20240103, { o: 10, c: 10, pc: 10 }],
        ]),
        ...quotesFor(CODE_B, [
          [20240102, { o: 20, c: 20, pc: 20 }],
          [20240103, { o: 20, c: 20, pc: 20 }],
        ]),
      ],
      factorRanges: {
        'equ_factor_obos.BIAS20': [
          { securityId: CODE_A, tradeDate: '2024-01-03', value: -2 },
          { securityId: CODE_B, tradeDate: '2024-01-03', value: 1 },
        ],
      },
    });
    const out = await svc.runStrategyBacktest(
      assertStrategyInput({
        ...cfg({
          maxPositions: 2,
          idealPositionPct: 50,
          sellRules: [{ kind: 'field', table: 'equ_factor_obos', field: 'BIAS20', op: '<', value: 0 }],
          executionTiming: 2,
        }),
      }),
    );
    const sellA = (out.card.trades ?? []).filter((t) => t.direction === 'sell' && t.code === CODE_A);
    expect(sellA.length).toBe(1);
    expect(sellA[0].date).toBe(20240103); // 信号日当日收盘成交（mode 0/1 为次日）
  });
});
