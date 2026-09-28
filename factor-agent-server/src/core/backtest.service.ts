import { Injectable } from '@nestjs/common';
import { FactorWeight, Holding, MetricItem, RawMetrics } from '../types';
import { STOCK_POOL } from './store.service';

/* ==========================================================
   模拟回测引擎（演示口径，无真实行情）
   用种子伪随机保证确定性：同一份策略配置永远得到同一份报告
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

/* ----- 种子伪随机：同一种子序列完全一致 ----- */

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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

@Injectable()
export class BacktestService {
  runBacktest(input: BacktestInput): BacktestOutput {
    const rand = mulberry32(hashStr(input.seedKey));

    // 月频 30 个点的净值曲线（口径与前端模拟公式一致，仅随机源换成种子）
    const curve = Array.from({ length: 30 }, (_, i) => {
      const trend = i * (0.5 + rand() * 0.5);
      const wave = Math.sin(i / 3) * 1.5;
      const noise = (rand() - 0.45) * 2.2;
      return +(100 + trend + wave + noise).toFixed(1);
    });
    curve[0] = 100; // 契约口径：净值曲线起点固定 100

    const total = curve[curve.length - 1] / 100 - 1;
    const metrics: RawMetrics = {
      annual: +((Math.pow(1 + total, 1 / 3) - 1) * 100).toFixed(1),
      drawdown: maxDrawdownPct(curve),
      sharpe: +(0.7 + rand() * 0.9).toFixed(2),
      winRate: +(52 + rand() * 11).toFixed(1),
    };

    return {
      curve,
      benchCurve: mkBench(curve),
      metrics,
      holdings: this.genHoldings(input, rand),
    };
  }

  /** 按因子权重给股票池打综合分，取 Top K（演示口径：单票权重递减） */
  private genHoldings(input: BacktestInput, rand: () => number): Holding[] {
    const factors = input.factors.length ? input.factors : [{ name: '综合', weight: 100 }];
    const scored = STOCK_POOL.map((stock) => {
      let sum = 0;
      let wSum = 0;
      for (const f of factors) {
        const w = f.weight / 100;
        sum += w * this.factorScore(stock.code, f.name, input.seedKey);
        wSum += w;
      }
      return { stock, score: +(sum / (wSum || 1)).toFixed(1) };
    }).sort((a, b) => b.score - a.score);

    const count = Math.max(1, Math.min(input.holdingsCount ?? 10, scored.length));
    return scored.slice(0, count).map((s, i) => ({
      code: s.stock.code,
      name: s.stock.name,
      score: s.score,
      weight: +Math.max(2.2, 6.2 - i * 0.45 + (rand() - 0.5) * 0.6).toFixed(1),
      change: +((rand() - 0.45) * 5).toFixed(2),
    }));
  }

  /** 个股 × 因子的确定性得分（60~98），换配置才变化 */
  private factorScore(code: string, factor: string, seedKey: string): number {
    const r = mulberry32(hashStr(`${seedKey}::${code}::${factor}`))();
    return +(60 + r * 38).toFixed(1);
  }
}
