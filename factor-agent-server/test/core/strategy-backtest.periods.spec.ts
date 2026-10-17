import { aggregatePeriodRows, buildPeriodHoldings, StrategyTrade } from '../../src/core/strategy-backtest.service';

/** 两期场景：4 个交易日，第 3 日（下标 2）开始第二期 */
const TRADE_DATES = [20240102, 20240103, 20240104, 20240105];

describe('aggregatePeriodRows（历史持仓详情按期聚合）', () => {
  const rows = aggregatePeriodRows({
    tradeDates: TRADE_DATES,
    equities: [100000, 101000, 102000, 103000], // 与 4 个交易日一一对应
    benchReturns: [0, 0.01, 0.02, -0.0098],
    turnoverByDay: [0, 100000, 20000, 10000],
    trades: [
      { date: 20240102, code: 'A', direction: 'buy', price: 10, shares: 10000, amount: 100000, fee: 0, reason: '调仓建仓' },
      { date: 20240103, code: 'B', direction: 'buy', price: 10, shares: 100, amount: 1000, fee: 0, reason: '调仓建仓' },
      { date: 20240104, code: 'A', direction: 'sell', price: 10, shares: 100, amount: 1000, fee: 0, reason: '调仓卖出' },
    ],
    periodStarts: [0, 2],
    exposureByDay: [100, 100, 50, 50],
    initialCapital: 100000,
  });

  it('输出两期，期序从 1 起', () => {
    expect(rows.map((r) => r.seq)).toEqual([1, 2]);
  });

  it('期间起止：末期止于最后交易日', () => {
    expect(rows[0]).toMatchObject({ startDate: 20240102, endDate: 20240103 });
    expect(rows[1]).toMatchObject({ startDate: 20240104, endDate: 20240105 });
  });

  it('本期收益：首期基期为初始资金，第二期基期为上期末权益', () => {
    expect(rows[0].periodReturnPct).toBe(1); // 101000/100000-1
    expect(rows[1].periodReturnPct).toBeCloseTo(1.98, 1); // 103000/101000-1
  });

  it('基准/超额：同期复合，超额=本期-基准', () => {
    expect(rows[0].benchReturnPct).toBeCloseTo(1, 1); // (1+0)*(1+0.01)-1 = 1%
    expect(rows[0].excessPct).toBeCloseTo(rows[0].periodReturnPct - rows[0].benchReturnPct, 1);
  });

  it('买卖只数：期间内按代码去重', () => {
    expect(rows[0]).toMatchObject({ buyCount: 2, sellCount: 0 });
    expect(rows[1]).toMatchObject({ buyCount: 0, sellCount: 1 });
  });

  it('期末持仓只数与仓位均值', () => {
    // D0 末 A 持仓=1 只；D1 末 A+B=2 只；D2 卖 A 部分（仍持有 A）+B=2 只
    expect(rows[0].stockCount).toBe(2);
    expect(rows[1].stockCount).toBe(2);
    expect(rows[1].positionPct).toBe(50);
    expect(rows[0].positionPct).toBe(100);
  });

  it('1000 元投资按期复利累计', () => {
    const expectCum = 1000 * (1 + rows[0].periodReturnPct / 100) * (1 + rows[1].periodReturnPct / 100);
    expect(rows[1].cumulativeValue).toBeCloseTo(expectCum, 0);
  });
});

describe('buildPeriodHoldings（每期持仓明细，重放交易流水）', () => {
  const DATES = [20240102, 20240103, 20240104, 20240105, 20240108, 20240109];
  const priceTable: Record<string, Record<number, number>> = {
    A: { 20240102: 10, 20240103: 12, 20240104: 12, 20240105: 12, 20240108: 13, 20240109: 13 },
    B: { 20240103: 20, 20240104: 22, 20240105: 23, 20240108: 25, 20240109: 25 },
    C: { 20240108: 30, 20240109: 33 },
  };
  const priceOf = (code: string, day: number) => priceTable[code]?.[day];
  const t = (date: number, code: string, direction: 'buy' | 'sell', price: number, shares: number): StrategyTrade => ({
    date, code, direction, price, shares, amount: price * shares, fee: 0, reason: direction === 'buy' ? '调仓建仓' : '调仓卖出',
  });
  const agg = buildPeriodHoldings(
    [
      t(20240102, 'A', 'buy', 10, 1000),
      t(20240103, 'B', 'buy', 20, 100),
      t(20240108, 'A', 'sell', 13, 1000),
      t(20240108, 'C', 'buy', 30, 200),
    ],
    DATES,
    [0, 3],
    priceOf,
  );

  it('两期切片：期界与期序', () => {
    expect(agg.periodHoldings.map((p) => [p.seq, p.startDate, p.endDate])).toEqual([
      [1, 20240102, 20240104],
      [2, 20240105, 20240109],
    ]);
  });

  it('期1：期末收盘快照，进入成本=买入价，期间收益与权重（按期末市值占比）', () => {
    expect(agg.periodHoldings[0].holdings).toEqual([
      { code: 'A', shares: 1000, closePrice: 12, entryPrice: 10, periodReturnPct: 20, weightPct: 84.51 },
      { code: 'B', shares: 100, closePrice: 22, entryPrice: 20, periodReturnPct: 10, weightPct: 15.49 },
    ]);
  });

  it('期2：连续持有股进入基准滚动为上期期末收盘；期内新进股用买入价；权重降序', () => {
    expect(agg.periodHoldings[1].holdings).toEqual([
      { code: 'C', shares: 200, closePrice: 33, entryPrice: 30, periodReturnPct: 10, weightPct: 72.53 },
      { code: 'B', shares: 100, closePrice: 25, entryPrice: 22, periodReturnPct: 13.64, weightPct: 27.47 },
    ]);
  });

  it('latestOrders=最后一期全部成交（时间正序）；recentSold=期内卖出代码去重', () => {
    expect(agg.latestOrders.map((x) => [x.code, x.direction])).toEqual([['A', 'sell'], ['C', 'buy']]);
    expect(agg.recentSold).toEqual(['A']);
  });
});
