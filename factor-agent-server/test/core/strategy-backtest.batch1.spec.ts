import { FactorDataService, QuoteRow } from '../../src/core/factor-data.service';
import { StrategyBacktestServiceImpl } from '../../src/core/implementations/strategy-backtest.service.impl';
import { matchKeepRule, type Position, type SellFieldData } from '../../src/core/account';
import {
  applyEntryFilters,
  assertStrategyInput,
  collectFactorRefs,
  INDEX_VALUE_KEY,
  type StrategyBacktestInput,
} from '../../src/core/strategy-backtest.service';

/* ==========================================================
   第一批新参数专项测试：大盘条件广播 + eq/bw（项1/4）、
   排除时间段冻结（项2，ADR-0002）、不卖条件保护矩阵（项3，ADR-0003）、
   每日选股（项5）。全流程 stub 不触库。
   ========================================================== */

const base: StrategyBacktestInput = {
  startDate: '20240101',
  endDate: '20241231',
  rebalanceIntervalDays: 21,
};

describe('assertStrategyInput：排除时间段（归一化：排序 → 合并重叠 → 裁剪越界）', () => {
  it('排序合并重叠段，越界段裁剪/丢弃', () => {
    const p = assertStrategyInput({
      ...base,
      excludeRanges: [
        { start: '20230101', end: '20240301' }, // 前段越界 → 裁剪到回测起点
        { start: '20241201', end: '20241231' },
        { start: '20240715', end: '20240901' },
        { start: '20240601', end: '20240731' },
        { start: '20250101', end: '20250601' }, // 完全越界 → 丢弃
      ],
    });
    expect(p.excludeRanges).toEqual([
      { start: 20240101, end: 20240301 }, // 越界前段裁剪到回测起点
      { start: 20240601, end: 20240901 }, // 两段重叠合并
      { start: 20241201, end: 20241231 }, // 区间内原样保留
    ]);
  });

  it('倒挂/非法格式/超段数 → INVALID_ARGUMENT', () => {
    expect(() => assertStrategyInput({ ...base, excludeRanges: [{ start: '20240801', end: '20240701' }] })).toThrow(/倒挂/);
    expect(() => assertStrategyInput({ ...base, excludeRanges: [{ start: '2024-08-01', end: '20240901' }] })).toThrow(/YYYYMMDD/);
    expect(() =>
      assertStrategyInput({
        ...base,
        excludeRanges: Array.from({ length: 6 }, (_, i) => ({ start: `2024010${i + 1}`, end: `2024010${i + 1}` })),
      }),
    ).toThrow(/最多 5 段/);
  });

  it('缺省 → 空数组（缺省逐位复现口径）', () => {
    expect(assertStrategyInput(base).excludeRanges).toEqual([]);
  });
});

describe('assertStrategyInput：不卖条件 keepRules', () => {
  it('合法条件归一化（含 bw 区间），引用进入 collectFactorRefs', () => {
    const p = assertStrategyInput({
      ...base,
      keepRules: [
        { table: 'equ_factor_obos', field: 'RSI', op: '<', value: 30 },
        { table: 'equ_factor_derive', field: 'X', op: 'bw', value: [10, 30] },
      ],
    });
    expect(p.keepRules).toEqual([
      { table: 'equ_factor_obos', field: 'RSI', op: '<', value: 30 },
      { table: 'equ_factor_derive', field: 'X', op: 'bw', value: [10, 30] },
    ]);
    const refs = collectFactorRefs(p);
    expect(refs).toContainEqual({ table: 'equ_factor_obos', field: 'RSI' });
    expect(refs).toContainEqual({ table: 'equ_factor_derive', field: 'X' });
  });

  it('指数表字段 / 非法 op / 缺 table → INVALID_ARGUMENT', () => {
    expect(() => assertStrategyInput({ ...base, keepRules: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '<', value: 3000 }] })).toThrow(/指数表/);
    expect(() => assertStrategyInput({ ...base, keepRules: [{ table: 't', field: 'f', op: '=', value: 1 }] })).toThrow(/op/);
    expect(() => assertStrategyInput({ ...base, keepRules: [{ field: 'f', op: '>', value: 1 }] })).toThrow(/table/);
  });
});

describe('entryFilters：eq/bw 与大盘条件广播（纯函数）', () => {
  const sec = new Map([['A', 10], ['B', 5], ['C', 1]]);

  it('eq 精确相等；bw 闭区间含两端', () => {
    expect(applyEntryFilters(['A', 'B', 'C'], [{ table: 't', field: 'f', op: 'eq', value: 5 }], [sec])).toEqual(['B']);
    expect(applyEntryFilters(['A', 'B', 'C'], [{ table: 't', field: 'f', op: 'bw', value: [5, 10] }], [sec])).toEqual(['A', 'B']);
  });

  it('大盘条件：指数值全池广播；缺值弃权（不清空股票池）', () => {
    const rules = [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>' as const, value: 2500 }];
    const hit = new Map([[INDEX_VALUE_KEY, 3000]]); // 广播截面：全池同值
    expect(applyEntryFilters(['A', 'B', 'C'], rules, [hit])).toEqual(['A', 'B', 'C']);
    expect(applyEntryFilters(['A', 'B', 'C'], [{ ...rules[0], value: 3001 }], [hit])).toEqual([]);
    expect(applyEntryFilters(['A', 'B', 'C'], rules, [new Map()])).toEqual(['A', 'B', 'C']); // 缺值弃权
  });

  it('大盘条件与个股条件混用：广播值恒定、个股各判各的', () => {
    const out = applyEntryFilters(
      ['A', 'B', 'C'],
      [
        { table: 'mkt_idxd', field: 'CLOSE_INDEX', op: 'bw', value: [2500, 3500] },
        { table: 't', field: 'f', op: '>', value: 4 },
      ],
      [new Map([[INDEX_VALUE_KEY, 3000]]), sec],
    );
    expect(out).toEqual(['A', 'B']);
  });
});

describe('matchKeepRule（不卖条件判定，ADR-0003）', () => {
  const pos: Position = { code: '000002.XSHE', shares: 100, entryPrice: 10, buyDayIdx: 0, peakClose: 11 };

  it('日期表命中 → 返回不卖原因；缺值 → 不成立', () => {
    const series: SellFieldData = new Map([
      ['equ_factor_obos.RSI', new Map([['000002.XSHE', new Map([[20240105, 30]])]])],
    ]);
    const rules = [{ table: 'equ_factor_obos', field: 'RSI', op: '<' as const, value: 50 }];
    expect(matchKeepRule(pos, 20240105, rules, series, new Set())).toBe('RSI满足不卖');
    expect(matchKeepRule(pos, 20240104, rules, series, new Set())).toBeNull(); // 该日缺值
    expect(matchKeepRule(pos, 20240105, [{ ...rules[0], op: '>', value: 50 }], series, new Set())).toBeNull();
  });

  it('静态表 + eq 条件命中', () => {
    const series: SellFieldData = new Map([['md_security.X', new Map([['000002.XSHE', 1]])]]);
    expect(matchKeepRule(pos, 20240105, [{ table: 'md_security', field: 'X', op: 'eq', value: 1 }], series, new Set(['md_security.X']))).not.toBeNull();
  });
});

/* ----- 引擎全流程 stub（不触库） ----- */

const TRADE_DATES = [20240102, 20240103, 20240104, 20240105];
const CODE_A = '000001.XSHE';
const CODE_B = '000002.XSHE';

function quoteRow(date: number, q: { o: number; c: number; pc: number }): QuoteRow {
  const s = String(date);
  return {
    ticker: s.startsWith('2024') ? '000001' : '000001',
    exchange: 'XSHE',
    tradeDate: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
    open: q.o,
    close: q.c,
    preClose: q.pc,
  };
}

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

/** A：10 → 10.5 → 11 → 9.9（末日 9.9 仍可买，跌停判定只挡卖出）；B：20 → 20 → 21 → 21.5 */
function defaultQuotes(): QuoteRow[] {
  return [
    ...quotesFor(CODE_A, [
      [20240102, { o: 10, c: 10, pc: 10 }],
      [20240103, { o: 10.5, c: 11, pc: 10 }],
      [20240104, { o: 11, c: 11, pc: 11 }],
      [20240105, { o: 9.9, c: 9.9, pc: 11 }],
    ]),
    ...quotesFor(CODE_B, [
      [20240102, { o: 20, c: 20, pc: 20 }],
      [20240103, { o: 20, c: 20, pc: 20 }],
      [20240104, { o: 21, c: 21, pc: 20 }],
      [20240105, { o: 21.5, c: 21.5, pc: 21 }],
    ]),
  ];
}

interface Fixture {
  /** REVS20 截面：日期 → (code → 值) */
  momentum: Record<number, Record<string, number>>;
  quotes: QuoteRow[];
  /** 不卖条件的区间序列："表.字段" → 行（readFactorRange 的返回） */
  factorRanges?: Record<string, { securityId: string; tradeDate: string; value: number }[]>;
}

function makeService(fixture: Fixture): StrategyBacktestServiceImpl {
  const factorData = {
    readTable: async () => [],
    readTradeDates: async () => ({ dates: TRADE_DATES, min: 20200101, max: 20241231 }),
    readFactorSection: async (_table: string, _field: string, date: string) => {
      const section = fixture.momentum[Number(date)] ?? {};
      return Object.entries(section).map(([securityId, value]) => ({ securityId, value }));
    },
    readFactorRange: async (table: string, field: string) => fixture.factorRanges?.[`${table}.${field}`] ?? [],
    readQuoteSeries: async () => fixture.quotes,
    readIndexDaily: async () => [
      { tradeDate: '2024-01-02', close: 100, preClose: 100 },
      { tradeDate: '2024-01-03', close: 101, preClose: 100 },
      { tradeDate: '2024-01-04', close: 102, preClose: 101 },
      { tradeDate: '2024-01-05', close: 101, preClose: 102 },
    ],
    readIndexFieldSeries: async () => [],
  } as unknown as FactorDataService;
  return new StrategyBacktestServiceImpl(factorData);
}

describe('排除时间段（引擎全流程，ADR-0002：只结算不交易、冻结估值）', () => {
  it('冻结日丢弃挂起指令且不产生交易：本该在冻结日执行的调仓被丢弃，等下一个调仓日', async () => {
    const service = makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 }, // → 候选 [B]（被冻结段丢弃，永不执行）
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },  // → 候选 [A]
      },
      quotes: defaultQuotes(),
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      rebalanceIntervalDays: 1, // 每日调仓：20240103 的调仓信号落入排除段
      maxPositions: 1,
      feeRate: 0,
      excludeRanges: [{ start: '20240103', end: '20240103' }],
    });
    const trades = out.card.trades ?? [];
    // 唯一成交 = 解冻后首个调仓日（20240104）信号在 20240105 执行的建仓；冻结日的调仓被丢弃
    expect(trades.map((t) => [t.date, t.direction, t.reason])).toEqual([[20240105, 'buy', '调仓建仓']]);
    // 冻结估值：冻结日与解冻首日（未建仓）权益与期初一致——净值走平，行情涨跌不进收益
    const curve = out.card.curve;
    expect(curve[0]).toBe(100);
    expect(curve[1]).toBe(100);
    expect(curve[2]).toBe(100);
    // 排除段内的调仓日不产出期行（无调仓发生）：期起始 = 0102 / 0104 / 0105
    expect((out.card.periodHoldings ?? []).map((r) => r.startDate)).toEqual([20240102, 20240104, 20240105]);
  });
});

describe('不卖条件（引擎全流程，ADR-0003：保护调仓换出 + 占坑）', () => {
  const momentum = {
    20240102: { [CODE_A]: 10, [CODE_B]: 20 }, // → 候选 [B]
    20240104: { [CODE_A]: 30, [CODE_B]: 5 },  // → 候选 [A]（B 跌出）
  };

  it('对照组：无不卖条件 → B 在下一调仓日被调仓卖出', async () => {
    const service = makeService({ momentum, quotes: defaultQuotes() });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      rebalanceIntervalDays: 2,
      maxPositions: 1,
      feeRate: 0,
    });
    const sells = (out.card.trades ?? []).filter((t) => t.direction === 'sell');
    expect(sells.map((t) => [t.date, t.reason])).toEqual([[20240105, '调仓卖出']]);
  });

  it('命中不卖条件 → B 不被调出、占坑顶掉 A 的买入（保 0 买 0）', async () => {
    const service = makeService({
      momentum,
      quotes: defaultQuotes(),
      factorRanges: { 'equ_factor_obos.RSI': [{ securityId: CODE_B, tradeDate: '2024-01-05', value: 30 }] },
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      rebalanceIntervalDays: 2,
      maxPositions: 1,
      feeRate: 0,
      keepRules: [{ table: 'equ_factor_obos', field: 'RSI', op: '<', value: 50 }],
    });
    const trades = out.card.trades ?? [];
    // B 建仓后持有到底：无调仓卖出、A 被 maxPositions 占坑挡住，全程只有一笔建仓
    expect(trades.map((t) => [t.date, t.direction, t.reason])).toEqual([[20240103, 'buy', '调仓建仓']]);
    expect((out.card.periodHoldings ?? []).at(-1)?.holdings.map((h) => h.code)).toEqual([CODE_B]);
  });
});

describe('runDailyScreen（每日选股：单日截面 → 过滤 → 排序 → 清单）', () => {
  function makeScreenService(momentum: Record<number, Record<string, number>>): StrategyBacktestServiceImpl {
    const factorData = {
      readTable: async () => [],
      readTradeDates: async () => ({ dates: TRADE_DATES, min: 20200101, max: 20241231 }),
      readFactorSection: async (_table: string, _field: string, date: string) => {
        const section = momentum[Number(date)] ?? {};
        return Object.entries(section).map(([securityId, value]) => ({ securityId, value }));
      },
      readFactorRange: async () => [],
      readQuoteSeries: async () => [],
      readIndexDaily: async () => [],
      readIndexFieldSeries: async () => [],
    } as unknown as FactorDataService;
    return new StrategyBacktestServiceImpl(factorData);
  }
  const sort = [{ table: 'equ_factor_obos', field: 'REVS20', direction: 1 as const }];

  it('指定交易日：过滤 + 排序 + 综合分与因子值', async () => {
    const service = makeScreenService({ 20240103: { [CODE_A]: 10, [CODE_B]: 20 } });
    const out = await service.runDailyScreen({
      entryFilters: [{ table: 'equ_factor_obos', field: 'REVS20', op: 'bw', value: [15, 30] }],
      sortFactors: sort,
      maxPositions: 1,
      date: '20240103',
    });
    expect(out.date).toBe(20240103);
    expect(out.rawPoolSize).toBe(2);
    expect(out.survivedCount).toBe(1); // B=20 在 [15,30] 区间内，A=10 被剔除
    expect(out.stocks).toEqual([{ code: CODE_B, score: 100, factorValues: [20] }]);
  });

  it('缺省 date = 最近交易日；非交易日回落前一交易日；未来日期报错', async () => {
    const service = makeScreenService({ 20240105: { [CODE_A]: 2, [CODE_B]: 1 } });
    expect((await service.runDailyScreen({ sortFactors: sort, maxPositions: 1 })).date).toBe(20240105);
    expect((await service.runDailyScreen({ sortFactors: sort, maxPositions: 1, date: '20240106' })).date).toBe(20240105);
    await expect(service.runDailyScreen({ sortFactors: sort, maxPositions: 1, date: '20250101' })).rejects.toThrow(/超出数据范围/);
  });

  it('大盘条件走广播通道：指数条件全池同判', async () => {
    const factorData = {
      readTable: async () => [],
      readTradeDates: async () => ({ dates: TRADE_DATES, min: 20200101, max: 20241231 }),
      readFactorSection: async () => [
        { securityId: CODE_A, value: 10 },
        { securityId: CODE_B, value: 20 },
      ],
      readFactorRange: async () => [],
      readQuoteSeries: async () => [],
      readIndexDaily: async () => [],
      readIndexFieldSeries: async () => [{ tradeDate: '2024-01-03', value: 3000 }],
    } as unknown as FactorDataService;
    const out = await new StrategyBacktestServiceImpl(factorData).runDailyScreen({
      entryFilters: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 2500 }],
      sortFactors: sort,
      maxPositions: 5,
      date: '20240103',
    });
    // 指数 3000 > 2500 → 全池存活，按 REVS20 排序 B 优先
    expect(out.survivedCount).toBe(2);
    expect(out.stocks.map((s) => s.code)).toEqual([CODE_B, CODE_A]);
  });
});
