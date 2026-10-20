import { ApiException } from '../../../src/common/api.exception';
import { ClarificationSignal } from '../../../src/core/strategy-backtest.service';
import { FactorDataService, QuoteRow } from '../../../src/core/factor-data.service';
import { StrategyBacktestServiceImpl } from '../../../src/core/implementations/strategy-backtest.service.impl';

/* ==========================================================
   权重/仓位函数 全流程 stub 测试：内化等价性对拍 + ic_weight/factor_position 挂载
   ========================================================== */

const TRADE_DATES = [20240102, 20240103, 20240104, 20240105];
const CODE_A = '000001.XSHE';
const CODE_B = '000002.XSHE';

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
    quoteRow('000001', 20240102, { o: 10, c: 10, pc: 10 }),
    quoteRow('000001', 20240103, { o: 10.5, c: 11, pc: 10 }),
    quoteRow('000001', 20240104, { o: 11, c: 11, pc: 11 }),
    quoteRow('000001', 20240105, { o: 9.9, c: 9.9, pc: 11 }),
    quoteRow('000002', 20240102, { o: 20, c: 20, pc: 20 }),
    quoteRow('000002', 20240103, { o: 20, c: 21, pc: 20 }),
    quoteRow('000002', 20240104, { o: 21, c: 21, pc: 21 }),
    quoteRow('000002', 20240105, { o: 21.5, c: 21.5, pc: 21 }),
  ];
}

interface Fixture {
  momentum: Record<number, Record<string, number>>;
  panels?: Record<string, Record<number, Record<string, number>>>;
  quotes: QuoteRow[];
}

function makeService(fixture: Fixture): StrategyBacktestServiceImpl {
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
    readIndexDaily: async () => [],
    readIndexFieldSeries: async () => [],
  } as unknown as FactorDataService;
  return new StrategyBacktestServiceImpl(factorData);
}

const baseArgs = {
  securityIds: [CODE_A, CODE_B],
  startDate: '20240101',
  endDate: '20240108',
  initialCapital: 100_000,
  feeRate: 0,
  rebalanceIntervalDays: 2,
  maxPositions: 2,
};

/** 两因子截面：REVS20 值大优选 B，RSI 值小优选 A——权重 [3,1] 偏向 REVS20 */
const twoFactorPanels = {
  'equ_factor_obos.REVS20': {
    20240102: { [CODE_A]: 10, [CODE_B]: 90 },
    20240104: { [CODE_A]: 20, [CODE_B]: 80 },
  },
  'equ_factor_obos.RSI': {
    20240102: { [CODE_A]: 30, [CODE_B]: 10 },
    20240104: { [CODE_A]: 40, [CODE_B]: 20 },
  },
};

describe('权重/仓位函数（全流程 stub，不触库）', () => {
  it('内化等价性对拍：constant_weights [3,1] ≡ 旧静态 weight 列同配置（交易与净值逐位一致）', async () => {
    const sortFactors = [
      { table: 'equ_factor_obos', field: 'REVS20', direction: 1 as const },
      { table: 'equ_factor_obos', field: 'RSI', direction: -1 as const },
    ];
    const legacy = await makeService({ momentum: {}, panels: twoFactorPanels, quotes: defaultQuotes() }).runStrategyBacktest({
      ...baseArgs,
      sortFactors: sortFactors.map((f, i) => ({ ...f, weight: [3, 1][i] })),
    });
    const functional = await makeService({ momentum: {}, panels: twoFactorPanels, quotes: defaultQuotes() }).runStrategyBacktest({
      ...baseArgs,
      sortFactors,
      weightFn: { name: 'constant_weights', params: { weights: [3, 1] } },
    });
    expect(functional.card.trades).toEqual(legacy.card.trades);
    expect(functional.card.curve).toEqual(legacy.card.curve);
    expect(functional.summary.权重函数).toContain('常数比例');
    expect(functional.summary.权重函数).toContain('[3,1]');
  });

  it('weightFn 与静态 weight 列同传 → 400（双轨互斥）', async () => {
    await expect(
      makeService({ momentum: {}, panels: twoFactorPanels, quotes: defaultQuotes() }).runStrategyBacktest({
        ...baseArgs,
        sortFactors: [
          { table: 'equ_factor_obos', field: 'REVS20', direction: 1 as const, weight: 3 },
          { table: 'equ_factor_obos', field: 'RSI', direction: -1 as const, weight: 1 },
        ],
        weightFn: { name: 'constant_weights', params: { weights: [3, 1] } },
      }),
    ).rejects.toThrow(/不可同时使用/);
  });

  it('未知函数名 → 400 附名录；参数不合法 → 澄清信号', async () => {
    await expect(
      makeService({ momentum: {}, quotes: defaultQuotes() }).runStrategyBacktest({ ...baseArgs, weightFn: { name: 'nope' } }),
    ).rejects.toThrow(/可用名录/);
    await expect(
      makeService({ momentum: {}, quotes: defaultQuotes() }).runStrategyBacktest({
        ...baseArgs,
        weightFn: { name: 'ic_weight', params: { icWindow: 1 } },
      }),
    ).rejects.toThrow(ClarificationSignal);
  });

  it('factor_position：定权因子 ≤0 的候选不买（金额 0），>0 独占资金', async () => {
    const out = await makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 },
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },
      },
      panels: {
        // BIAS20：A 站上均线（>0），B 在下方（≤0）→ B 金额 0 不买
        'equ_factor_obos.BIAS20': {
          20240102: { [CODE_A]: 0.2, [CODE_B]: -0.1 },
          20240104: { [CODE_A]: 0.3, [CODE_B]: -0.2 },
        },
      },
      quotes: defaultQuotes(),
    }).runStrategyBacktest({
      ...baseArgs,
      positionFn: { name: 'factor_position', params: { factor: { table: 'equ_factor_obos', field: 'BIAS20' } } },
    });
    // 0103 建仓只有 A（B 金额 0 跳过）：A 独占目标市值（10 万 × 50% 理想仓位 = 5 万 → T+1 开盘 10.5 → 4700 股）
    const trades = out.card.trades ?? [];
    expect(trades.filter((t) => t.code === CODE_B)).toEqual([]);
    expect(trades[0]).toMatchObject({
      date: 20240103,
      code: CODE_A,
      direction: 'buy',
      price: 10.5,
      shares: 4700,
      amount: 49_350,
      reason: '调仓建仓',
    });
    expect((out.card.params ?? []).some((r) => r.label === '仓位函数')).toBe(true);
  });

  it('ic_weight：全流程可跑（IC 上下文按窗口预取，不触未来）', async () => {
    const out = await makeService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 },
        20240103: { [CODE_A]: 12, [CODE_B]: 19 },
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },
      },
      quotes: defaultQuotes(),
    }).runStrategyBacktest({
      ...baseArgs,
      weightFn: { name: 'ic_weight' },
    });
    expect(out.card.curve.length).toBeGreaterThan(0);
    expect(out.summary.权重函数).toContain('IC');
  });

  it('触发模式 + 函数 → 400（二期再议）', async () => {
    await expect(
      makeService({ momentum: {}, quotes: defaultQuotes() }).runStrategyBacktest({
        ...baseArgs,
        rebalanceIntervalDays: 0,
        positionDeviatePct: 10,
        weightFn: { name: 'constant_weights' },
      }),
    ).rejects.toThrow(/触发模式/);
  });
});
