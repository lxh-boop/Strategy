import { Account } from '../../src/core/account';
import { scaleLimitPrices } from '../../src/core/factor-data.service';

/* ==========================================================
   涨跌停总开关（ADR-0009）单测：官方价换算 + Account 闸 + 总仓位拉回内建闸
   判定口径 = 前复权口径官方涨跌停价（触及即不成交）；缺行降级 = 不判、计数
   ========================================================== */

describe('scaleLimitPrices（官方价 → 前复权口径换算）', () => {
  it('factor=1（无分红历史）：官方价原样透传', () => {
    const out = scaleLimitPrices(11.44, 11.44, 12.58, 10.3);
    expect(out.limitUp).toBeCloseTo(12.58, 10);
    expect(out.limitDown).toBeCloseTo(10.3, 10);
  });

  it('factor≠1（300750 样例：累计分红 raw 215.95 → adj 110.736）：官方价按同日因子缩放', () => {
    const out = scaleLimitPrices(110.736, 215.95, 237.55, 194.36);
    expect(out.limitUp).toBeCloseTo((237.55 * 110.736) / 215.95, 6);
    expect(out.limitDown).toBeCloseTo((194.36 * 110.736) / 215.95, 6);
    // 换算后相对 adjPreClose 的涨幅应等于官方价相对 rawPreClose 的涨幅（等价性）
    expect(out.limitUp! / 110.736).toBeCloseTo(237.55 / 215.95, 10);
  });

  it('原始昨收缺失/非正 → 两侧均 null（缺行降级）', () => {
    expect(scaleLimitPrices(10, null, 11, 9)).toEqual({ limitUp: null, limitDown: null });
    expect(scaleLimitPrices(10, 0, 11, 9)).toEqual({ limitUp: null, limitDown: null });
  });

  it('单侧缺行只降级该侧', () => {
    const out = scaleLimitPrices(10, 10, 11, null);
    expect(out.limitUp).toBeCloseTo(11, 10);
    expect(out.limitDown).toBeNull();
  });
});

describe('Account 涨跌停闸（buy/sell 原语内建）', () => {
  const limits = (code: string, day: number) => {
    if (day === 20240102) return undefined; // 首日无官方价（缺行）
    if (code === 'A') return { limitUp: 11, limitDown: 9 };
    return { limitUp: null, limitDown: null }; // B：两侧缺行
  };

  it('开关开启：触及涨停拒买、触及跌停拒卖，未触及照常成交', () => {
    const acc = new Account(100_000, { feeRate: 0, limitUpDownSkip: true, limitPricesOf: limits });
    acc.buy('A', 1000, 11, 20240103, 1, '调仓建仓'); // 11 ≥ 涨停价 11 → 拒
    expect(acc.positionOf('A')).toBeUndefined();
    expect(acc.trades()).toHaveLength(0);
    acc.buy('A', 1000, 10.99, 20240103, 1, '调仓建仓'); // 未触及 → 成交
    expect(acc.positionOf('A')?.shares).toBe(1000);
    acc.sell(acc.positionOf('A')!, 500, 9, 20240103, '调仓卖出'); // 9 ≤ 跌停价 9 → 拒
    expect(acc.positionOf('A')?.shares).toBe(1000);
    acc.sell(acc.positionOf('A')!, 500, 9.01, 20240103, '调仓卖出'); // 未触及 → 成交
    expect(acc.positionOf('A')?.shares).toBe(500);
    expect(acc.limitBlockedCount()).toBe(2);
  });

  it('开关开启：官方价缺行/无行情行 → 不判照常成交，计入缺行计数', () => {
    const acc = new Account(100_000, { feeRate: 0, limitUpDownSkip: true, limitPricesOf: limits });
    acc.buy('A', 100, 11, 20240102, 0, '调仓建仓'); // 20240102 无行情行 → 不判
    expect(acc.positionOf('A')?.shares).toBe(100);
    acc.buy('B', 100, 50, 20240103, 1, '调仓建仓'); // B 两侧缺行 → 不判
    expect(acc.positionOf('B')?.shares).toBe(100);
    expect(acc.limitNoDataCount()).toBe(2);
    expect(acc.limitBlockedCount()).toBe(0);
  });

  it('开关关闭（对照模式）：涨跌停价照常成交，不计数', () => {
    const acc = new Account(100_000, { feeRate: 0, limitUpDownSkip: false, limitPricesOf: limits });
    acc.buy('A', 1000, 11, 20240103, 1, '调仓建仓');
    acc.sell(acc.positionOf('A')!, 1000, 9, 20240103, '调仓卖出');
    expect(acc.trades()).toHaveLength(2);
    expect(acc.limitBlockedCount()).toBe(0);
    expect(acc.limitNoDataCount()).toBe(0);
  });

  it('未注入 limitPricesOf（缺省开启）：全部按缺行降级照常成交', () => {
    const acc = new Account(100_000, { feeRate: 0 });
    acc.buy('A', 1000, 11, 20240103, 1, '调仓建仓');
    expect(acc.positionOf('A')?.shares).toBe(1000);
    expect(acc.limitNoDataCount()).toBe(1);
  });
});

describe('Account.rebalanceToTotal 涨跌停闸内建（b1 清出/补仓同源语义）', () => {
  it('加仓方向：现价触及涨停 → 拒买', () => {
    const acc = new Account(100_000, {
      feeRate: 0,
      limitUpDownSkip: true,
      limitPricesOf: (code, day) => (day >= 20240103 ? { limitUp: 9.9, limitDown: 9.5 } : undefined),
    });
    acc.buy('A', 100, 10, 20240102, 0, '调仓建仓'); // invested 1000，现金 99000
    const t0 = acc.trades().length;
    // 目标 50% ≫ 当前 1% → 加仓路径；加仓价 10 ≥ 涨停 9.9 → 全部拒买
    acc.rebalanceToTotal(50, 1, 20240103, 1, { trim: '择时减仓', add: '择时加仓' }, { priceOf: () => 10 });
    expect(acc.trades().length).toBe(t0);
    expect(acc.limitBlockedCount()).toBeGreaterThan(0);
  });

  it('减仓方向：现价触及跌停 → 拒卖（仓位维持不动）', () => {
    const acc = new Account(100_000, {
      feeRate: 0,
      limitUpDownSkip: true,
      limitPricesOf: (code, day) => (day >= 20240103 ? { limitUp: 10.5, limitDown: 10 } : undefined),
    });
    acc.buy('A', 5000, 10, 20240102, 0, '调仓建仓'); // invested 50000
    const t0 = acc.trades().length;
    acc.rebalanceToTotal(10, 1, 20240103, 1, { trim: '择时减仓', add: '偏离带减仓' }, { priceOf: () => 10 });
    expect(acc.trades().length).toBe(t0); // 10 ≤ 跌停 10 → 全部拒卖
  });

  it('开关关闭：同样触及场景照常减仓', () => {
    const acc = new Account(100_000, {
      feeRate: 0,
      limitUpDownSkip: false,
      limitPricesOf: (code, day) => (day >= 20240103 ? { limitUp: 10.5, limitDown: 10 } : undefined),
    });
    acc.buy('A', 5000, 10, 20240102, 0, '调仓建仓');
    acc.rebalanceToTotal(10, 1, 20240103, 1, { trim: '择时减仓', add: '偏离带减仓' }, { priceOf: () => 10 });
    expect(acc.trades().some((t) => t.reason === '择时减仓')).toBe(true);
  });
});
