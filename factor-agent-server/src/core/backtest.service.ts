import { Injectable } from '@nestjs/common';
import { FactorWeight, Holding, MetricItem, RawMetrics } from '../types';

/* ==========================================================
   回测接口（契约层）—— 定义"回测能做什么"，不关心净值怎么算。
   实现：implementations/mock-backtest.service.ts（种子伪随机模拟引擎）
   ========================================================== */

/** 净值曲线 → 模拟基准曲线（与前端 mkBench 相同参数） */
export function mkBench(curve: number[], beta = 0.45, wobble = 1.8): number[] {
  return curve.map((v, i) => +(100 + (v - 100) * beta + Math.sin(i / 4) * wobble).toFixed(1));
}

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

export interface BacktestInput {
  /** 确定性种子来源：策略配置或会话上下文的任意稳定字符串 */
  seedKey: string;
  factors: FactorWeight[];
  universe: string;
  rebalance: string;
  /** 持仓只数（Top K 的演示口径），默认 10 */
  holdingsCount?: number;
}

export interface BacktestOutput {
  curve: number[];
  benchCurve: number[];
  metrics: RawMetrics;
  holdings: Holding[];
}

/**
 * 回测接口：输入策略配置，输出净值曲线 / 绩效指标 / 持仓。
 * 契约口径：曲线起点固定 100；百分比是 14.6（14.6%）不是 0.146。
 */
@Injectable()
export abstract class BacktestService {
  abstract runBacktest(input: BacktestInput): BacktestOutput;
}
