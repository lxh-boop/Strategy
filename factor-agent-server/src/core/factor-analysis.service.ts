import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api.exception';

/* ==========================================================
   因子分析契约（排名分析 + 因子相关性矩阵）—— 果仁「排名分析」对标
   口径（已拍板）：
   - IC = 个股级标准口径：因子截面 vs 下期个股收益的 Spearman 秩相关
     （公共股票配对、任一侧缺值剔除、并列取平均秩）；
   - 段收益 = 段内成员等权收盘收益均值（收盘调仓、无费用）——因子研究分析
     口径而非交易模拟，与个股级 IC 自洽；
   - 排列单调性 = 段序 vs 段收益秩相关的 r²（0~1，果仁原文口径）。
   段 1 恒为因子最优先段（direction=1 值大优 / -1 值小优）。
   ========================================================== */

/** 分析用单因子引用 */
export interface AnalysisFactorRef {
  table: string;
  field: string;
  /** 1=值大优（段 1 为高值段）/ -1=值小优（段 1 为低值段） */
  direction: 1 | -1;
}

export interface RankAnalysisInput {
  sortFactor: AnalysisFactorRef;
  /** 股票池（null/缺省 = 截面有值的全部股票） */
  securityIds?: string[] | null;
  /** 分段数 2~10 */
  segmentCount: number;
  /** 分析间隔（交易日）：每 N 个交易日取一次截面并调仓段组合 */
  intervalDays: number;
  startDate: string;
  endDate: string;
}

export interface RankAnalysisOutput {
  /** IC 序列（每期：因子截面 vs 下期个股收益） */
  icSeries: { date: number; ic: number }[];
  /** IC 均值（样本不足时缺省） */
  icMean?: number;
  /** IC>0 期数占比 % */
  icPositiveProb?: number;
  /** 因子 IR = IC 均值 ÷ IC 标准差（0 或 1 期时缺省） */
  icIR?: number;
  /** 各段平均单期收益 %（段 1 = 最优先段） */
  segmentMeanReturnPct: number[];
  /** 各段区间累计收益 %（各期段收益连乘-1×100） */
  segmentCumulativePct: number[];
  /** 逐期段收益 %（段×期，期序 = 采样期对顺序；某期段内无成员为 null）。旧存量卡无此字段 */
  segmentPeriodReturnsPct?: (number | null)[][];
  /** 多空虚拟净值（段 1 做多 − 末段做空，逐期收益差复合，起点 100）。旧存量卡无此字段 */
  longShortSeries?: { date: number; nav: number }[];
  /** IC 衰减：持有期 1~5 日的平均 IC（该档无有效期对则缺档）。旧存量卡无此字段 */
  icDecay?: { lag: number; ic: number }[];
  /** 排列单调性 r²（0~1） */
  monotonicityR2: number;
  /** 多空价差 %：第 1 段 − 末段 的平均单期收益差 */
  longShortSpreadPct: number;
  /** 有效分析期数（期对数） */
  periodCount: number;
}

export interface FactorCorrelationInput {
  /** 2~10 个因子：两两相关 */
  refs: AnalysisFactorRef[];
  securityIds?: string[] | null;
  /** 采样间隔（交易日）：每 N 个交易日取一次各因子截面 */
  intervalDays: number;
  startDate: string;
  endDate: string;
}

export interface FactorCorrelationOutput {
  /** 因子标识顺序（"table.field"），与矩阵行列一致 */
  factors: string[];
  /** 对称相关矩阵：对角线 1；某因子截面缺失/样本不足的配对为 null */
  matrix: (number | null)[][];
  /** 参与均值的采样期数 */
  periodCount: number;
}

/* ----- 纯函数 ----- */

/** 秩（并列取平均秩，1 起） */
function ranksOf(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

/** 两序列 Spearman 秩相关；并列平均秩；分母 0（全并列）返回 undefined */
function spearmanOnPairs(a: number[], b: number[]): number | undefined {
  const n = a.length;
  if (n < 2 || n !== b.length) return undefined;
  const ra = ranksOf(a);
  const rb = ranksOf(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / n;
  const ma = mean(ra);
  const mb = mean(rb);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ra[i] - ma) * (rb[i] - mb);
    va += (ra[i] - ma) ** 2;
    vb += (rb[i] - mb) ** 2;
  }
  if (va === 0 || vb === 0) return undefined;
  return cov / Math.sqrt(va * vb);
}

/** 两截面 Spearman 秩相关：公共 code 配对、任一侧缺值/非有限剔除；有效对 <2 返回 undefined */
export function spearmanOnCrossSection(xs: Map<string, number>, ys: Map<string, number>): number | undefined {
  const xsV: number[] = [];
  const ysV: number[] = [];
  for (const [code, x] of xs) {
    const y = ys.get(code);
    if (y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    xsV.push(x);
    ysV.push(y);
  }
  return spearmanOnPairs(xsV, ysV);
}

/** 排列单调性：段序 vs 段平均收益的秩相关 r²（0~1；完美单调=1，全并列=0） */
export function monotonicityR2(segmentMeanReturns: number[]): number {
  if (segmentMeanReturns.length < 2) return 0;
  const rho = spearmanOnPairs(
    segmentMeanReturns.map((_, i) => i),
    segmentMeanReturns,
  );
  return rho === undefined ? 0 : +(rho * rho).toFixed(4);
}

/** 因子截面 → N 段：按因子方向排序后连续均分（余数摊给前面的段）；段 1 = 最优先段；空段为 [] */
export function segmentCrossSection(values: Map<string, number>, direction: 1 | -1, segments: number): string[][] {
  const entries = [...values.entries()].filter(([, v]) => Number.isFinite(v));
  entries.sort((a, b) => (direction === 1 ? b[1] - a[1] : a[1] - b[1]));
  const out: string[][] = Array.from({ length: segments }, () => []);
  const base = Math.floor(entries.length / segments);
  const rem = entries.length % segments;
  let cursor = 0;
  for (let k = 0; k < segments; k++) {
    const take = base + (k < rem ? 1 : 0);
    out[k] = entries.slice(cursor, cursor + take).map(([code]) => code);
    cursor += take;
  }
  return out;
}

/* ----- 契约 ----- */

@Injectable()
export abstract class FactorAnalysisService {
  /** 排名分析：单因子分段有效性评估（IC/单调性/分段收益/多空价差） */
  abstract runRankAnalysis(input: RankAnalysisInput): Promise<RankAnalysisOutput>;

  /** 因子相关性：一批因子两两截面秩相关矩阵（逐采样期计算后取均值） */
  abstract runFactorCorrelation(input: FactorCorrelationInput): Promise<FactorCorrelationOutput>;
}

/** 护栏：分段数与采样间隔（与引擎护栏同风格，中文文案面向模型） */
export function assertAnalysisParams(segmentCount: number, intervalDays: number): void {
  if (!Number.isInteger(segmentCount) || segmentCount < 2 || segmentCount > 10) {
    throw new ApiException('INVALID_ARGUMENT', 400, `segmentCount 须为 2~10 的整数（分段数）: ${segmentCount}`);
  }
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 250) {
    throw new ApiException('INVALID_ARGUMENT', 400, `intervalDays 须为 1~250 的整数（分析间隔，交易日）: ${intervalDays}`);
  }
}
