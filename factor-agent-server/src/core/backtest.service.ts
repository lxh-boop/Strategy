import { FactorWeight, MetricItem, RawMetrics } from '../types';

/* ==========================================================
   回测共享工具 —— 策略回测引擎（strategy-backtest）与策略库共用的纯函数。
   历史上的 mock 回测引擎已下线：策略的创建/回测统一收口到
   对话 → StrategyBacktestService（日频事件内核，真实因子库数据）。
   ========================================================== */

/** 最大回撤 %（负数），与前端 maxDrawdownPct 一致 */
export function maxDrawdownPct(curve: number[]): number {
  let peak = curve[0];
  let dd = 0;
  for (const v of curve) {
    peak = Math.max(peak, v);
    dd = Math.min(dd, (v / peak - 1) * 100);
  }
  return +dd.toFixed(1);
}

/**
 * 因子权重归一化（与前端 normalizeWeights 同一算法）：
 * 合计 ≠ 100 时按比例折算到 100，保留 1 位小数，残差补给最大权重项；
 * 合计 ≤ 0 属非法输入（前端同样视为非法）。
 */
export function normalizeWeights(factors: FactorWeight[]): FactorWeight[] {
  const total = factors.reduce((a, f) => a + f.weight, 0);
  if (total <= 0) return factors.map((f) => ({ ...f, weight: 0 }));
  const scaled = factors.map((f) => ({ ...f, weight: +((f.weight * 100) / total).toFixed(1) }));
  const residual = +(100 - scaled.reduce((a, f) => a + f.weight, 0)).toFixed(1);
  if (residual !== 0) {
    const maxIdx = scaled.reduce((mi, f, i, arr) => (f.weight > arr[mi].weight ? i : mi), 0);
    scaled[maxIdx].weight = +(scaled[maxIdx].weight + residual).toFixed(1);
  }
  return scaled;
}

/** 指标数值 → 展示卡片 metrics（value 为展示字符串，cls 由符号决定） */
export function toMetricItems(m: RawMetrics): MetricItem[] {
  const mFmt = (v: number) => (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  return [
    { label: '年化收益', value: mFmt(m.annual), cls: m.annual > 0 ? 'up' : 'down' },
    { label: '最大回撤', value: m.drawdown.toFixed(1) + '%', cls: 'down' },
    { label: '夏普比率', value: m.sharpe.toFixed(2) },
    { label: '胜率', value: m.winRate.toFixed(1) + '%' },
  ];
}
