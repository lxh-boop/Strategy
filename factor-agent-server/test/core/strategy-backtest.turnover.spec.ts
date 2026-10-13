import { annualizeTurnover } from '../../src/core/strategy-backtest.service';

/* ==========================================================
   年化换手（单边）公式单元测试：纯函数，不触库不依赖 DI
   回归：分母必须是"平均权益"而非"权益合计"——
   旧实现分母用 Σ(每日权益) 后又乘 252/n，等于多除一个 n：
   659 天回测把年化 ~1500% 显示成 +4%（2026-10-13 实测抓到）
   ========================================================== */

describe('annualizeTurnover 年化换手（单边）', () => {
  it('常数权益 + 恒定日成交：单边日换手 10% × 252 交易日 = 年化 2520%', () => {
    // 每天双边成交 20 万（单边 10 万 = 权益的 10%），权益恒为 100 万，恰一年（252 天）
    const turnoverByDay = Array(252).fill(200_000);
    const equities = Array(252).fill(1_000_000);
    expect(annualizeTurnover(turnoverByDay, equities)).toBeCloseTo(2520, 0);
  });

  it('仅调仓日成交（5 日调仓量级）：年化应在数千个百分点量级，而非个位数', () => {
    const days = 659;
    const turnoverByDay = Array(days).fill(0);
    for (let i = 0; i < 132; i++) turnoverByDay[i * 5] = 1_500_000; // 双边 150 万 = 单边 75% 权益
    const equities = Array(days).fill(1_000_000);
    // 单边累计 132 × 75 万 = 9900 万；年化 = 9900万/100万 × (252/659) × 100 ≈ 3786%
    // 旧公式（÷Σ权益）会算出 ≈5.7%——本用例对其回归
    expect(annualizeTurnover(turnoverByDay, equities)).toBeGreaterThan(3000);
  });

  it('无成交或空数组 → 0', () => {
    expect(annualizeTurnover([], [1, 2, 3])).toBe(0);
    expect(annualizeTurnover([0, 0], [100, 100])).toBe(0);
  });
});
