import { Injectable } from '@nestjs/common';
import { FactorWeight, Holding, RawMetrics } from '../../types';
import { STOCK_POOL } from '../store.service';
import {
  BacktestInput,
  BacktestOutput,
  BacktestService,
  maxDrawdownPct,
  mkBench,
} from '../backtest.service';

/* ==========================================================
   回测实现：种子伪随机模拟引擎（数据口径）
   - 随机数据：mulberry32 伪随机生成净值/指标/涨跌
   - 测试样例：STOCK_POOL 演示股票池打综合分取 Top K
   确定性保证：同一种子序列完全一致——同一份策略配置永远得到同一份报告。
   ========================================================== */

/** 种子伪随机：FNV-1a 哈希 → mulberry32 */
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

@Injectable()
export class MockBacktestService extends BacktestService {
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
