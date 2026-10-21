import { ApiException } from '../../../src/common/api.exception';
import {
  applyEntryFilters,
  assertStrategyInput,
  ClarificationSignal,
  collectFactorRefs,
  DEFAULT_MOMENTUM_FACTOR,
  describeSortFactors,
  effectiveSortFactors,
  legacyConfigToInput,
  monthlyReturns,
  rankUniverse,
  StrategyBacktestInput,
  StrategyBacktestService,
} from '../../../src/core/strategy-backtest.service';
import { FactorDataService, QuoteRow } from '../../../src/core/factor-data.service';
import { StrategyBacktestServiceImpl } from '../../../src/core/implementations/strategy-backtest.service.impl';

// 行业/池引擎 stub：不触 DuckDB（factory 内字面量，hoist 作用域限制不引外部变量）
jest.mock('../../../src/core/industry-engine', () => ({
  resolvePoolSpec: async (groups: Array<{ kind: string; names?: string[] }>) => ({
    securities: ['000001.XSHE', '000002.XSHE'],
    unknownIndustry: groups.filter((g) => g.kind === 'industry').flatMap((g) => g.names ?? []).filter((n) => n === '不存在行业'),
    unknownIndex: [] as string[],
  }),
  industryClarificationGuide: async () => ({ 请从申万一级行业名录重选: true }),
  indexClarificationGuide: async () => ({ 请修正指数代码: true }),
}));

/* ==========================================================
   策略回测（日频事件内核）单元测试：入参归一化/纯函数/全流程 stub 不触库
   ========================================================== */

const base: StrategyBacktestInput = {
  startDate: '20240101',
  endDate: '20241231',
  rebalanceIntervalDays: 21,
};

describe('assertStrategyInput（归一化与校验）', () => {
  it('缺 rebalanceIntervalDays → 澄清信号（必填无默认值）', () => {
    expect(() => assertStrategyInput({ startDate: '20240101', endDate: '20241231' })).toThrow(ClarificationSignal);
  });

  it('默认值：initialCapital=100万 / feeRate=万三 / maxPositions=10 / idealPct=100/max / timing=0', () => {
    const p = assertStrategyInput(base);
    expect(p.initialCapital).toBe(1_000_000);
    expect(p.feeRate).toBe(0.0003);
    expect(p.maxPositions).toBe(10);
    expect(p.idealPositionPct).toBe(10);
    expect(p.minPositionPct).toBe(1);
    expect(p.executionTiming).toBe(0);
    expect(p.securityIds).toBeNull();
    expect(p.strategyType).toBe('equal_weight');
  });

  it('maxPositions=1 时 idealPositionPct 缺省=100%（满仓等权）', () => {
    const p = assertStrategyInput({ ...base, maxPositions: 1 });
    expect(p.idealPositionPct).toBe(100);
  });

  it('区间缺失/非法 → INVALID_ARGUMENT', () => {
    expect(() => assertStrategyInput({ rebalanceIntervalDays: 5 })).toThrow(ApiException);
    expect(() => assertStrategyInput({ ...base, endDate: '20240101' })).toThrow(/start 早于 end/);
    expect(() => assertStrategyInput({ ...base, startDate: '2024-01-01' })).toThrow(ApiException);
  });

  it('securityIds：格式校验 000002.XSHE + 去重；空数组视为全市场', () => {
    const p = assertStrategyInput({ ...base, securityIds: ['000002.XSHE', '000002.XSHE', '600000.XSHG'] });
    expect(p.securityIds).toEqual(['000002.XSHE', '600000.XSHG']);
    expect(assertStrategyInput({ ...base, securityIds: [] }).securityIds).toBeNull();
    expect(() => assertStrategyInput({ ...base, securityIds: ['000002'] })).toThrow(/000002.XSHE/);
  });

  it('静态 weight 列已删除：sortFactors 只认 table/field/direction，自定义权重走 weightFn', () => {
    const p = assertStrategyInput({
      ...base,
      sortFactors: [{ table: 'equ_factor_obos', field: 'REVS20', direction: 1 as const, weight: 2 }],
    });
    expect((p.sortFactors[0] as unknown as Record<string, unknown>).weight).toBeUndefined();
  });

  it('direction / op / sellRule kind 非法 → INVALID_ARGUMENT', () => {
    expect(() =>
      assertStrategyInput({ ...base, sortFactors: [{ table: 't', field: 'f', direction: 0 as unknown as 1 }] }),
    ).toThrow(/direction/);
    expect(() =>
      assertStrategyInput({ ...base, entryFilters: [{ table: 't', field: 'f', op: '=' as unknown as '>', value: 1 }] }),
    ).toThrow(/op/);
    expect(() => assertStrategyInput({ ...base, sellRules: [{ kind: 'unknown' as never }] })).toThrow(/kind/);
    expect(() => assertStrategyInput({ ...base, sellRules: [{ kind: 'stop_loss', pct: -1 }] })).toThrow(/pct/);
  });
});

describe('effectiveSortFactors / collectFactorRefs（默认动量兜底与引用集合）', () => {
  it('sortFactors 为空 → 兜底默认 20 日动量（REVS20 值大优）', () => {
    const eff = effectiveSortFactors([]);
    expect(eff.usedDefault).toBe(true);
    expect(eff.factors).toEqual([DEFAULT_MOMENTUM_FACTOR]);
    expect(DEFAULT_MOMENTUM_FACTOR).toEqual({ table: 'equ_factor_obos', field: 'REVS20', direction: 1 });
  });

  it('非空 → 原样使用，不追加', () => {
    const factors = [{ table: 'equ_factor_obos', field: 'RSI', direction: -1 as const }];
    const eff = effectiveSortFactors(factors);
    expect(eff.usedDefault).toBe(false);
    expect(eff.factors).toBe(factors);
  });

  it('collectFactorRefs：过滤 + 有效排序 + field 卖出规则，去重保序', () => {
    const p = assertStrategyInput({
      ...base,
      entryFilters: [{ table: 'equ_factor_derive', field: 'NETPROFITTTM', op: '>', value: 0 }],
      sortFactors: [],
      sellRules: [
        { kind: 'field', table: 'equ_factor_obos', field: 'MA20UP', op: '<', value: 1 },
        { kind: 'stop_loss', pct: 5 },
      ],
    });
    const refs = collectFactorRefs(p);
    expect(refs).toEqual([
      { table: 'equ_factor_derive', field: 'NETPROFITTTM' },
      { table: 'equ_factor_obos', field: 'REVS20' },
      { table: 'equ_factor_obos', field: 'MA20UP' },
    ]);
  });

  it('describeSortFactors：方向如实展示（确认弹窗契约）', () => {
    const s = describeSortFactors([
      { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
      { table: 'equ_factor_obos', field: 'RSI', direction: -1 },
    ]);
    expect(s).toContain('REVS20（值大优）');
    expect(s).toContain('RSI（值小优）');
  });
});

describe('applyEntryFilters（过滤纯函数）', () => {
  const secA = new Map([['A', 10], ['B', 5], ['C', 1]]);

  it('全部满足才存活', () => {
    const out = applyEntryFilters(['A', 'B', 'C'], [{ table: 't', field: 'f', op: '>', value: 4 }], [secA]);
    expect(out).toEqual(['A', 'B']);
  });

  it('多条件 AND；缺失值视为不满足', () => {
    const out = applyEntryFilters(
      ['A', 'B', 'C'],
      [
        { table: 't', field: 'f', op: '>', value: 4 },
        { table: 't', field: 'g', op: '>', value: 0 },
      ],
      [secA, new Map([['A', 1]])],
    );
    expect(out).toEqual(['A']);
  });
});

describe('rankUniverse（分位数合成纯函数）', () => {
  it('direction=1 值大分位高；direction=-1 值小分位高；综合分降序', () => {
    const pool = ['A', 'B', 'C', 'D'];
    const ranked = rankUniverse(
      [
        { table: 't', field: 'f1', direction: 1 },
        { table: 't', field: 'f2', direction: -1 },
      ],
      [
        new Map([['A', 1], ['B', 2], ['C', 3], ['D', 4]]),   // f1 升序分位：A=25 B=50 C=75 D=100
        new Map([['A', 10], ['B', 20], ['C', 30], ['D', 40]]), // f2 值小优：A=100 B=75 C=50 D=25
      ],
      pool,
    );
    // 等权合成（分位口径 (排名)/n）：f1 A=25 B=50 C=75 D=100；f2 值小优反向 A=75 B=50 C=25 D=0
    // → 四股并列 50，按 code 次序稳定输出
    expect(ranked).toHaveLength(4);
    expect(ranked[0].score).toBeCloseTo(50, 1);
    expect(ranked.map((r) => r.code)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('缺某因子的股票按可得因子重归一化；全缺不入选', () => {
    const ranked = rankUniverse(
      [{ table: 't', field: 'f1', direction: 1 }],
      [new Map([['A', 5], ['B', 1]])],
      ['A', 'B', 'C'],
    );
    expect(ranked.map((r) => r.code)).toEqual(['A', 'B']); // C 无值不入选
    expect(ranked[0].score).toBe(100);
  });

  it('weights 参数加权：方向相反的两因子按权重倾斜', () => {
    const ranked = rankUniverse(
      [
        { table: 't', field: 'f1', direction: 1 },
        { table: 't', field: 'f2', direction: 1 },
      ],
      [
        new Map([['A', 1], ['B', 2]]),
        new Map([['A', 100], ['B', 200]]),
      ],
      ['A', 'B'],
      [3, 1],
    );
    expect(ranked[0].code).toBe('B'); // B 两因子分位均更高
  });
});

describe('monthlyReturns（月度归因）', () => {
  it('按自然月切分，首月基期为初始权益', () => {
    const dates = [20240102, 20240131, 20240201, 20240228, 20240301];
    const eq = [100, 110, 110, 99, 110];
    expect(monthlyReturns(dates, eq)).toEqual([
      { month: '2024-01', pct: 10 },
      { month: '2024-02', pct: -10 },
      { month: '2024-03', pct: 11.11 }, // 110/99 - 1
    ]);
  });

  it('长度不等/空 → 空数组', () => {
    expect(monthlyReturns([], [])).toEqual([]);
    expect(monthlyReturns([20240102], [])).toEqual([]);
  });
});

describe('legacyConfigToInput（旧等权配置适配）', () => {
  it('factors → sortFactors、frequency → 交易日数、topK → maxPositions', () => {
    const input = legacyConfigToInput({
      factors: [
        { table: 'equ_factor_obos', field: 'REVS20', order: 'desc' },
        { table: 'equ_factor_obos', field: 'RSI', order: 'asc' },
      ],
      startDate: '20220101',
      endDate: '20241231',
      frequency: 'monthly',
      topK: 20,
      benchmark: 'csi500',
      feeRate: 0.001,
    });
    expect(input.sortFactors).toEqual([
      { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
      { table: 'equ_factor_obos', field: 'RSI', direction: -1 },
    ]);
    expect(input.rebalanceIntervalDays).toBe(21);
    expect(input.maxPositions).toBe(20);
    expect(input.benchmark).toBe('csi500');
    expect(input.feeRate).toBe(0.001);
  });

  it('custom 频率用 everyNTd', () => {
    const input = legacyConfigToInput({
      factors: [{ table: 't', field: 'f', order: 'desc' }],
      startDate: '20220101',
      endDate: '20241231',
      frequency: 'custom',
      everyNTd: 7,
      topK: 5,
      benchmark: 'hs300',
    });
    expect(input.rebalanceIntervalDays).toBe(7);
  });
});

/* ----- 全流程 stub 测试（不触库） ----- */

/** 交易日历与数据面板：2024-01-02 ~ 2024-01-05 共 4 个交易日，两只股票 A/B */
const TRADE_DATES = [20240102, 20240103, 20240104, 20240105];

function quoteRow(ticker: string, date: number, q: { o: number; c: number; pc: number }): QuoteRow {
  const s = String(date);
  return {
    ticker,
    exchange: 'XSHE',
    tradeDate: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
    open: q.o,
    close: q.c,
    preClose: q.pc,
  };
}

/** 行情面板（温和波动，避开 ±10% 涨跌停判定） */
function defaultQuotes(): QuoteRow[] {
  return [
    // A：10 → 11 → 11 → 9.9（末日跌近 10% 但仍是买入方，跌停判定只挡卖出）
    quoteRow('000001', 20240102, { o: 10, c: 10, pc: 10 }),
    quoteRow('000001', 20240103, { o: 10.5, c: 11, pc: 10 }),
    quoteRow('000001', 20240104, { o: 11, c: 11, pc: 11 }),
    quoteRow('000001', 20240105, { o: 9.9, c: 9.9, pc: 11 }),
    // B：20 → 21 → 21 → 21.5
    quoteRow('000002', 20240102, { o: 20, c: 20, pc: 20 }),
    quoteRow('000002', 20240103, { o: 20, c: 21, pc: 20 }),
    quoteRow('000002', 20240104, { o: 21, c: 21, pc: 21 }),
    quoteRow('000002', 20240105, { o: 21.5, c: 21.5, pc: 21 }),
  ];
}

interface Fixture {
  /** 指数字段序列（择时用）：交易日 YYYYMMDD → 字段值；未传 = 无择时序列 */
  indexSeries?: Record<number, number>;
  /** REVS20 截面：日期 → (code → 值) */
  momentum: Record<number, Record<string, number>>;
  /** 按列名区分的截面（"表.字段" → 日期 → (code → 值)）；缺省该列回落 momentum——排序列对齐回归用 */
  panels?: Record<string, Record<number, Record<string, number>>>;
  quotes: QuoteRow[];
}

function makeService(fixture: Fixture): StrategyBacktestServiceImpl {
  const indexSeriesRows = Object.entries(fixture.indexSeries ?? {}).map(([d, v]) => {
    const day = String(d);
    return { tradeDate: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, value: v };
  });
  const factorData = {
    readTable: async () => [],
    readTradeDates: async () => ({ dates: TRADE_DATES, min: 20200101, max: 20241231 }),
    readFactorSection: async (table: string, field: string, date: string) => {
      const panel = fixture.panels?.[`${table}.${field}`] ?? fixture.momentum;
      const section = panel[Number(date)] ?? {};
      return Object.entries(section).map(([securityId, value]) => ({ securityId, value }));
    },
    readFactorRange: async () => [],
    readQuoteSeries: async () => fixture.quotes,
    readIndexDaily: async () => [
      { tradeDate: '2024-01-02', close: 100, preClose: 100 },
      { tradeDate: '2024-01-03', close: 101, preClose: 100 },
      { tradeDate: '2024-01-04', close: 102, preClose: 101 },
      { tradeDate: '2024-01-05', close: 101, preClose: 102 },
    ],
    readIndexFieldSeries: async () => indexSeriesRows,
  } as unknown as FactorDataService;
  return new StrategyBacktestServiceImpl(factorData);
}

const CODE_A = '000001.XSHE';
const CODE_B = '000002.XSHE';

describe('StrategyBacktestServiceImpl（全流程 stub，不触库）', () => {
  it('T+1 建仓 + 调仓换仓：信号日收盘出信号，次日开盘执行；净值/交易明细/默认动量兜底', async () => {
    const service = makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 }, // → 候选 [B]
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },  // → 候选 [A]
      },
      quotes: defaultQuotes(),
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2, // 调仓日 = 0102 / 0104
      maxPositions: 1,
    });

    // 交易明细：0103 建仓 B（0102 收盘信号，T+1 开盘执行）；0105 卖 B 买 A
    expect(out.card.trades).toEqual([
      { date: 20240103, code: CODE_B, direction: 'buy', price: 20, shares: 5000, amount: 100_000, fee: 0, reason: '调仓建仓' },
      { date: 20240105, code: CODE_B, direction: 'sell', price: 21.5, shares: 5000, amount: 107_500, fee: 0, reason: '调仓卖出' },
      { date: 20240105, code: CODE_A, direction: 'buy', price: 9.9, shares: 10_800, amount: 106_920, fee: 0, reason: '调仓建仓' },
    ]);
    // 净值：起点 100 → B 涨到 21（105000）→ 持仓不变（105000）→ 换仓 A 后 107500
    expect(out.card.curve).toEqual([100, 105, 105, 107.5]);
    expect(out.card.dates).toEqual(TRADE_DATES);
    // 默认动量兜底如实进卡片/摘要
    expect(out.summary.排序因子).toContain('REVS20');
    expect(out.summary.排序因子).toContain('引擎默认追加');
    expect(out.card.config).toMatchObject({ strategyType: 'equal_weight', rebalanceIntervalDays: 2, maxPositions: 1 });
    // 每期持仓明细：两期切片，期末收盘快照、连续持有股进入基准滚动
    expect(out.card.periodHoldings).toEqual([
      { seq: 1, startDate: 20240102, endDate: 20240103, holdings: [
        { code: CODE_B, shares: 5000, closePrice: 21, entryPrice: 20, periodReturnPct: 5, weightPct: 100 },
      ] },
      { seq: 2, startDate: 20240104, endDate: 20240105, holdings: [
        { code: CODE_A, shares: 10800, closePrice: 9.9, entryPrice: 9.9, periodReturnPct: 0, weightPct: 100 },
      ] },
    ]);
    expect(out.card.latestOrders?.map((t) => [t.code, t.direction])).toEqual([
      [CODE_B, 'sell'], [CODE_A, 'buy'],
    ]);
    expect(out.card.recentSold).toEqual([CODE_B]);
  });

  it('排序列按列名对齐：过滤列与排序列不同时，排序用排序列而非过滤列（错位修复回归）', async () => {
    const service = makeService({
      momentum: {},
      panels: {
        // RSI 只做过滤（<100 全通过），值与 REVS20 相反：错用 RSI 排名会选 B，对齐后按 REVS20 选 A
        'equ_factor_obos.RSI': {
          20240102: { [CODE_A]: 5, [CODE_B]: 95 },
          20240104: { [CODE_A]: 5, [CODE_B]: 95 },
        },
        'equ_factor_obos.REVS20': {
          20240102: { [CODE_A]: 90, [CODE_B]: 10 },
          20240104: { [CODE_A]: 90, [CODE_B]: 10 },
        },
      },
      quotes: defaultQuotes(),
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 1,
      entryFilters: [{ table: 'equ_factor_obos', field: 'RSI', op: '<', value: 100 }],
      sortFactors: [{ table: 'equ_factor_obos', field: 'REVS20', direction: 1 }],
    });
    expect(out.card.trades?.[0]).toMatchObject({ date: 20240103, code: CODE_A, direction: 'buy' });
  });

  it('卖出规则 stop_loss：收盘触发次日执行；现金不足时按可用资金缩股建仓', async () => {
    const quotes = [
      quoteRow('000001', 20240102, { o: 10, c: 10, pc: 10 }),
      quoteRow('000001', 20240103, { o: 10.5, c: 11, pc: 10 }),
      quoteRow('000001', 20240104, { o: 11, c: 11, pc: 11 }),
      quoteRow('000001', 20240105, { o: 9.9, c: 9.9, pc: 11 }),
      quoteRow('000002', 20240102, { o: 20, c: 20, pc: 20 }),
      quoteRow('000002', 20240103, { o: 20, c: 21, pc: 20 }),
      quoteRow('000002', 20240104, { o: 19.5, c: 19, pc: 20 }), // 收盘 19 = 入场价 20 的 -5% → 触发止损
      quoteRow('000002', 20240105, { o: 19.4, c: 19.4, pc: 19 }),
    ];
    const service = makeService({
      momentum: {
        20240102: { [CODE_A]: 1, [CODE_B]: 2 },  // → [B]
        20240104: { [CODE_A]: 99, [CODE_B]: 1 }, // → [A]
      },
      quotes,
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 1,
      sellRules: [{ kind: 'stop_loss', pct: 5 }],
    });

    const trades = out.card.trades ?? [];
    expect(trades.map((t) => [t.date, t.code, t.direction, t.reason])).toEqual([
      [20240103, CODE_B, 'buy', '调仓建仓'],
      [20240105, CODE_B, 'sell', '止损-5%'],
      [20240105, CODE_A, 'buy', '调仓建仓'], // 现金 97000 不足满额 106920 → 缩股至 9700
    ]);
    expect(trades[2].shares).toBe(9700);
    expect(trades[2].amount).toBeCloseTo(96_030, 0);
  });

  it('停牌顺延：执行日无行情 → 卖出顺延、候选跳过、持仓按最近收盘估值', async () => {
    const quotes = defaultQuotes().filter((r) => !(r.ticker === '000002' && r.tradeDate === '2024-01-05'));
    const service = makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 }, // → [B]
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },  // → [A]
      },
      quotes,
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 1,
    });

    // B 停牌卖不出（持有顺延）、A 现金为 0 买不进 → 全程只有建仓 B 一笔交易
    expect(out.card.trades).toHaveLength(1);
    expect(out.card.trades?.[0]).toMatchObject({ code: CODE_B, direction: 'buy' });
    expect(out.card.curve).toEqual([100, 105, 105, 105]);
    expect((out.summary.期末持仓 as { 代码: string; 股数: number }[] | undefined)?.[0]).toMatchObject({
      代码: CODE_B,
      股数: 5000,
    });
  });

  it('大盘择时熊市：先满仓建仓，条件转熊后次日全额择时减仓，后续不再建仓', async () => {
    const service = makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 }, // → [B]
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },  // → [A]（但目标仓位已被择时压到 0，不会建仓）
      },
      quotes: defaultQuotes(),
      // 指数：D0=6000（牛票成立），D1 起跌到 2000（恒为熊票）→ D1 收盘转熊，D2 起空仓
      indexSeries: { 20240102: 6000, 20240103: 2000, 20240104: 2000, 20240105: 2000 },
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 1,
      timingOverlay: {
        index: 'sse',
        rules: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 5000 }],
        enterVotes: -1,
        exitVotes: -1,
        bearPositionPct: 0,
      },
    });
    const trades = out.card.trades ?? [];
    expect(trades.map((t) => [t.date, t.code, t.direction, t.reason])).toEqual([
      [20240103, CODE_B, 'buy', '调仓建仓'],   // D1：D0 收盘仍为牛 → 满仓建仓
      [20240104, CODE_B, 'sell', '择时减仓'],  // D2：D1 收盘转熊 → 全额清仓（T+1 已解锁）
    ]);
    // D2 之后空仓：不再有任何买入
    expect(trades.every((t) => t.date <= 20240104)).toBe(true);
    expect(out.summary.期末持仓).toEqual([]);
    expect(out.card.positionDist).toEqual([
      { label: '100%(满仓)', days: 2 },
      { label: '0%(空仓)', days: 2 },
    ]);
    expect(out.card.holdingDaysPct).toBe(50);
    // 踏空归因：D2 暴露 0 而基准上涨（102/101-1 ≈ 0.99%）
    expect(out.card.missedRallies?.some((m) => m.date === 20240104)).toBe(true);
    // 确认门/卡片参数行
    expect((out.card.params ?? []).some((row) => row.label === '大盘择时')).toBe(true);
  });

  it('大盘择时熊市仓位 50%：转熊后不全清，按市值收敛到半仓', async () => {
    const service = makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 },
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },
      },
      quotes: defaultQuotes(),
      indexSeries: { 20240102: 6000, 20240103: 2000, 20240104: 2000, 20240105: 2000 },
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 1,
      timingOverlay: {
        index: 'sse',
        rules: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 5000 }],
        enterVotes: -1,
        exitVotes: -1,
        bearPositionPct: 50,
      },
    });
    const trades = out.card.trades ?? [];
    // D2 择时减仓收敛到半仓；20240105 是调仓日——择时只压总仓位，调仓日轮动照常（B→A）
    expect(trades.map((t) => [t.date, t.direction, t.reason])).toEqual([
      [20240103, 'buy', '调仓建仓'],
      [20240104, 'sell', '择时减仓'],
      [20240105, 'sell', '调仓卖出'],
      [20240105, 'buy', '调仓建仓'],
    ]);
    // 择时减仓：目标市值 52500 ÷ 21 元 = 2500 股
    const sellTrade = trades.find((t) => t.reason === '择时减仓')!;
    expect(sellTrade.shares).toBe(2500);
    // 调仓日建仓 A 的目标市值也被压在半仓（10 万权益 × 100% × 50%）
    const buyTrade = trades.find((t) => t.reason === '调仓建仓' && t.date === 20240105)!;
    expect(buyTrade.amount).toBeLessThanOrEqual(52_500);
  });

  it('大盘择时 + positionDeviatePct 带宽：偏离未超带宽不触发择时减仓（带宽参数接通调仓模式）', async () => {
    const service = makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 },
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },
      },
      quotes: defaultQuotes(),
      indexSeries: { 20240102: 6000, 20240103: 2000, 20240104: 2000, 20240105: 2000 },
    });
    const out = await service.runStrategyBacktest({
      securityIds: [CODE_A, CODE_B],
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 1,
      positionDeviatePct: 50,
      timingOverlay: {
        index: 'sse',
        rules: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 5000 }],
        enterVotes: -1,
        exitVotes: -1,
        bearPositionPct: 90,
      },
    });
    // 转熊后暴露 90%：持仓偏离目标约 10% < 带宽 50% → 不应有择时减仓（缺省 1% 阈值时会减）
    expect((out.card.trades ?? []).some((t) => t.reason === '择时减仓')).toBe(false);
  });

  it('全部调仓日无候选（因子截面为空）→ 报错不跑引擎', async () => {
    const service = makeService({ momentum: {}, quotes: [] });
    await expect(
      service.runStrategyBacktest({
        startDate: '20240101',
        endDate: '20240108',
        rebalanceIntervalDays: 2,
      }),
    ).rejects.toThrow(/无可用候选/);
  });

  it('区间超出数据范围 → 报错', async () => {
    const service = makeService({ momentum: { 20240102: { [CODE_A]: 1 } }, quotes: [] });
    await expect(
      service.runStrategyBacktest({
        startDate: '20250101',
        endDate: '20251231',
        rebalanceIntervalDays: 2,
      }),
    ).rejects.toThrow(/超出数据范围/);
  });
});

describe('股票池筛选入卡（pool 摘要即参数，回测卡不再误报全市场）', () => {
  const momentum = {
    20240102: { '000001.XSHE': 10, '000002.XSHE': 20 },
    20240104: { '000001.XSHE': 30, '000002.XSHE': 5 },
  };

  it('池模式：卡片与摘要股票池 = 筛选摘要+成员数，全文不再出现"全市场"', async () => {
    const service = makeService({ momentum, quotes: defaultQuotes() });
    const out = await service.runStrategyBacktest({
      pool: { groups: [{ kind: 'industry', names: ['有色金属'] }], summary: '有色金属', memberCount: 2 },
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 2,
    });
    expect(out.summary.股票池).toBe('有色金属（2 只）');
    const pool = out.card.params?.find((r) => r.label === '股票池');
    expect(pool?.value).toBe('有色金属（2 只）');
    expect(JSON.stringify(out)).not.toContain('全市场');
  });

  it('池与显式清单同传：显示交集口径', async () => {
    const service = makeService({ momentum, quotes: defaultQuotes() });
    const out = await service.runStrategyBacktest({
      securityIds: ['000001.XSHE', '000002.XSHE'],
      pool: { groups: [{ kind: 'industry', names: ['有色金属'] }], summary: '有色金属', memberCount: 2 },
      startDate: '20240101',
      endDate: '20240108',
      initialCapital: 100_000,
      feeRate: 0,
      rebalanceIntervalDays: 2,
      maxPositions: 2,
    });
    expect(out.summary.股票池).toBe('有色金属（2 只）∩2 只清单');
  });

  it('未知行业 → ClarificationSignal（预检语义不回归）', async () => {
    const service = makeService({ momentum, quotes: defaultQuotes() });
    await expect(
      service.runStrategyBacktest({
        pool: { groups: [{ kind: 'industry', names: ['不存在行业'] }], summary: '不存在行业', memberCount: 0 },
        startDate: '20240101',
        endDate: '20240108',
        initialCapital: 100_000,
        feeRate: 0,
        rebalanceIntervalDays: 2,
        maxPositions: 2,
      }),
    ).rejects.toThrow(ClarificationSignal);
  });
});
