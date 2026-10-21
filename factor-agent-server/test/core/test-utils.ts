import { FactorDataService, QuoteRow } from '../../src/core/factor-data.service';
import { StrategyBacktestServiceImpl } from '../../src/core/implementations/strategy-backtest.service.impl';

/* ==========================================================
   引擎全流程 stub 测试共享 harness（原 4 份 spec 副本收敛于此）：
   - TRADE_DATES / CODE_A / CODE_B / quoteRow / quotesFor / defaultQuotes：行情夹具
   - EngineFixture + makeFactorDataStub + makeStrategyService：全流程 stub 服务
   各 spec 的微差（readIndexDaily 行数、factorRanges 有无）经 fixture 可选字段覆盖。
   ========================================================== */

export const TRADE_DATES = [20240102, 20240103, 20240104, 20240105];
export const CODE_A = '000001.XSHE';
export const CODE_B = '000002.XSHE';

export function quoteRow(ticker: string, date: number, q: { o: number; c: number; pc: number }): QuoteRow {
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

export function quotesFor(ticker: string, rows: [number, { o: number; c: number; pc: number }][]): QuoteRow[] {
  return rows.map(([date, q]) => quoteRow(ticker, date, q));
}

/** A：10 → 10.5 → 11 → 9.9（末日 9.9 仍可买，跌停判定只挡卖出）；B：20 → 20 → 21 → 21.5。
 *  注意 ticker 用裸代码（000001），引擎按 `${ticker}.${exchange}` 拼完整代码 */
export function defaultQuotes(): QuoteRow[] {
  return [
    ...quotesFor('000001', [
      [20240102, { o: 10, c: 10, pc: 10 }],
      [20240103, { o: 10.5, c: 11, pc: 10 }],
      [20240104, { o: 11, c: 11, pc: 11 }],
      [20240105, { o: 9.9, c: 9.9, pc: 11 }],
    ]),
    ...quotesFor('000002', [
      [20240102, { o: 20, c: 20, pc: 20 }],
      [20240103, { o: 20, c: 20, pc: 20 }],
      [20240104, { o: 21, c: 21, pc: 20 }],
      [20240105, { o: 21.5, c: 21.5, pc: 21 }],
    ]),
  ];
}

export interface EngineFixture {
  /** 指数字段序列（择时用）：交易日 YYYYMMDD → 字段值；未传 = 无择时序列 */
  indexSeries?: Record<number, number>;
  /** REVS20 截面：日期 → (code → 值) */
  momentum: Record<number, Record<string, number>>;
  /** 按列名区分的截面（"表.字段" → 日期 → (code → 值)）；缺省该列回落 momentum */
  panels?: Record<string, Record<number, Record<string, number>>>;
  /** 不卖条件的区间序列："表.字段" → 行（readFactorRange 的返回） */
  factorRanges?: Record<string, { securityId: string; tradeDate: string; value: number }[]>;
  quotes: QuoteRow[];
}

export function makeFactorDataStub(fixture: EngineFixture): FactorDataService {
  const indexSeriesRows = Object.entries(fixture.indexSeries ?? {}).map(([d, v]) => {
    const day = String(d);
    return { tradeDate: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`, value: v };
  });
  return {
    readTable: async () => [],
    readTradeDates: async () => ({ dates: TRADE_DATES, min: 20200101, max: 20241231 }),
    readFactorSection: async (table: string, field: string, date: string) => {
      const panel = fixture.panels?.[`${table}.${field}`] ?? fixture.momentum;
      const section = panel[Number(date)] ?? {};
      return Object.entries(section).map(([securityId, value]) => ({ securityId, value }));
    },
    readFactorRange: async (table?: string, field?: string) =>
      fixture.factorRanges?.[`${table}.${field}`] ?? [],
    readQuoteSeries: async () => fixture.quotes,
    readIndexDaily: async () => [
      { tradeDate: '2024-01-02', close: 100, preClose: 100 },
      { tradeDate: '2024-01-03', close: 101, preClose: 100 },
      { tradeDate: '2024-01-04', close: 102, preClose: 101 },
      { tradeDate: '2024-01-05', close: 101, preClose: 102 },
    ],
    readIndexFieldSeries: async () => indexSeriesRows,
  } as unknown as FactorDataService;
}

export function makeStrategyService(fixture: EngineFixture): StrategyBacktestServiceImpl {
  return new StrategyBacktestServiceImpl(makeFactorDataStub(fixture));
}
