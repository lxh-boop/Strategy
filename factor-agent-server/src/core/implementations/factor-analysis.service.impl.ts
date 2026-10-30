import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { FactorDataService } from '../factor-data.service';
import {
  assertAnalysisParams,
  bucketMeansOf,
  FactorAnalysisService,
  FactorCorrelationInput,
  FactorCorrelationOutput,
  FactorProfileInput,
  FactorProfileOutput,
  monotonicityR2,
  quantileAt,
  RankAnalysisInput,
  RankAnalysisOutput,
  segmentCrossSection,
  spearmanOnCrossSection,
} from '../factor-analysis.service';

/**
 * 因子分析实现：复用引擎同款取数（截面/前复权日线/日历），计算在内存。
 * 口径见契约头注释（个股级 IC、段收益=等权收盘均值无费用）。
 */
/** IC 衰减的持有期档（交易日）：果仁「因子IC/IR衰减」按持有期口径，1~5 日起步 */
const IC_DECAY_MAX_LAG = 5;

@Injectable()
export class FactorAnalysisServiceImpl extends FactorAnalysisService {
  constructor(@Inject(FactorDataService) private readonly factorData: FactorDataService) {
    super();
  }

  async runRankAnalysis(input: RankAnalysisInput): Promise<RankAnalysisOutput> {
    assertAnalysisParams(input.segmentCount, input.intervalDays);
    // ① 日历（因子表作日历源，区间越界即抛——文案与引擎一致）
    const coverage = await this.factorData.readTradeDates(input.sortFactor.table, input.startDate, input.endDate);
    if (Number(input.startDate) < coverage.min || Number(input.endDate) > coverage.max) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `分析区间超出数据范围：${input.sortFactor.table} 可用区间 ${coverage.min}~${coverage.max}，请调整 startDate/endDate`,
      );
    }
    const tradeDates = coverage.dates;
    if (tradeDates.length < 2) {
      throw new ApiException('INVALID_ARGUMENT', 400, `区间 ${input.startDate}~${input.endDate} 内交易日不足（${tradeDates.length} 天），无法分析`);
    }
    const sampleIdx = tradeDates.map((_, i) => i).filter((i) => i % input.intervalDays === 0);
    if (sampleIdx.length < 2) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `分析期数不足（${sampleIdx.length} 期，至少 2 期）：请缩短 intervalDays 或扩大区间`,
      );
    }

    // ② 逐采样期截面 → 分段（段 1 = 最优先段）
    const periods: { date: number; values: Map<string, number>; segments: string[][] }[] = [];
    for (const idx of sampleIdx) {
      const date = String(tradeDates[idx]);
      const section = await this.factorData.readFactorSection(
        input.sortFactor.table,
        input.sortFactor.field,
        date,
        input.securityIds ?? null,
      );
      const values = new Map(section.map((r) => [r.securityId, r.value] as const));
      periods.push({
        date: tradeDates[idx],
        values,
        segments: segmentCrossSection(values, input.sortFactor.direction, input.segmentCount),
      });
    }
    const involved = [...new Set(periods.flatMap((p) => [...p.values.keys()]))];
    if (!involved.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, '因子截面为空（无任何股票有因子值），请调整因子/股票池/区间');
    }

    // ③ 涉及股票行情一次拉取（前复权收盘；close 非正按脏数据丢弃，同引擎口径）
    const quoteRows = await this.factorData.readQuoteSeries(involved, input.startDate, input.endDate);
    const closeByCode = new Map<string, Map<number, number>>();
    for (const row of quoteRows) {
      if (!(row.close > 0)) continue;
      const code = `${row.ticker}.${row.exchange}`;
      let byDay = closeByCode.get(code);
      if (!byDay) {
        byDay = new Map<number, number>();
        closeByCode.set(code, byDay);
      }
      byDay.set(Number(row.tradeDate.replaceAll('-', '')), row.close);
    }
    const closeOf = (code: string, day: number): number | undefined => closeByCode.get(code)?.get(day);

    // ④ 期对：个股收益（期末收盘/期初收盘-1）→ 个股级 IC + 段等权收益 + 逐期段收益序列
    const segCum = Array.from({ length: input.segmentCount }, () => 1);
    const segSum = new Array<number>(input.segmentCount).fill(0);
    const segPeriods = new Array<number>(input.segmentCount).fill(0);
    const segPeriodReturns: (number | null)[][] = Array.from({ length: input.segmentCount }, () => []);
    const icSeries: { date: number; ic: number }[] = [];
    for (let k = 0; k + 1 < periods.length; k++) {
      const cur = periods[k];
      const nextDate = periods[k + 1].date;
      const returns = new Map<string, number>();
      for (const [code, factorValue] of cur.values) {
        const c0 = closeOf(code, cur.date);
        const c1 = closeOf(code, nextDate);
        if (c0 !== undefined && c1 !== undefined && c0 > 0) returns.set(code, c1 / c0 - 1);
      }
      const ic = spearmanOnCrossSection(cur.values, returns);
      if (ic !== undefined) icSeries.push({ date: cur.date, ic: +ic.toFixed(4) });
      cur.segments.forEach((members, seg) => {
        const rs = members.map((c) => returns.get(c)).filter((r): r is number => r !== undefined);
        if (!rs.length) {
          segPeriodReturns[seg].push(null); // 期对齐：该期段内无成员
          return;
        }
        const segRet = rs.reduce((a, b) => a + b, 0) / rs.length;
        segSum[seg] += segRet;
        segCum[seg] *= 1 + segRet;
        segPeriods[seg]++;
        segPeriodReturns[seg].push(+(segRet * 100).toFixed(4));
      });
    }
    if (!icSeries.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, '有效分析期数为 0（截面/行情缺失导致全部期对无效），请调整区间或因子');
    }

    // ④′ 多空虚拟净值（段 1 − 末段 逐期收益差复合，起点 100；任一侧缺成员的期跳过）
    const longShortSeries: { date: number; nav: number }[] = [];
    let lsNav = 100;
    for (let k = 0; k + 1 < periods.length; k++) {
      const r1 = segPeriodReturns[0][k];
      const rN = segPeriodReturns[input.segmentCount - 1][k];
      if (r1 === null || rN === null) continue;
      lsNav *= 1 + (r1 - rN) / 100;
      longShortSeries.push({ date: periods[k].date, nav: +lsNav.toFixed(2) });
    }

    // ④″ IC 衰减：持有期 1~5 日（交易日）的平均 IC——因子信号随持有期拉长的衰减速度
    const dateIdxOf = new Map(tradeDates.map((d, i) => [d, i] as const));
    const icDecay: { lag: number; ic: number }[] = [];
    for (let lag = 1; lag <= IC_DECAY_MAX_LAG; lag++) {
      const ics: number[] = [];
      for (const cur of periods) {
        const curIdx = dateIdxOf.get(cur.date);
        const fwd = curIdx !== undefined ? tradeDates[curIdx + lag] : undefined;
        if (fwd === undefined) continue;
        const fwdReturns = new Map<string, number>();
        for (const [code] of cur.values) {
          const c0 = closeOf(code, cur.date);
          const c1 = closeOf(code, fwd);
          if (c0 !== undefined && c1 !== undefined && c0 > 0) fwdReturns.set(code, c1 / c0 - 1);
        }
        const ic = spearmanOnCrossSection(cur.values, fwdReturns);
        if (ic !== undefined) ics.push(ic);
      }
      if (ics.length) icDecay.push({ lag, ic: +(ics.reduce((a, b) => a + b, 0) / ics.length).toFixed(4) });
    }

    // ⑤ 聚合：IC 统计 + 段收益 + 单调性 + 多空
    const ics = icSeries.map((s) => s.ic);
    const icMean = +(ics.reduce((a, b) => a + b, 0) / ics.length).toFixed(4);
    const icPositiveProb = +((ics.filter((ic) => ic > 0).length / ics.length) * 100).toFixed(2);
    const std = Math.sqrt(ics.reduce((s, ic) => s + (ic - icMean) ** 2, 0) / ics.length);
    const segmentMeanReturnPct = segSum.map((s, i) => (segPeriods[i] ? +((s / segPeriods[i]) * 100).toFixed(4) : 0));
    return {
      icSeries,
      icMean,
      icPositiveProb,
      icIR: ics.length > 1 && std > 0 ? +(icMean / std).toFixed(4) : undefined,
      segmentMeanReturnPct,
      segmentCumulativePct: segCum.map((c) => +((c - 1) * 100).toFixed(2)),
      segmentPeriodReturnsPct: segPeriodReturns,
      longShortSeries,
      icDecay,
      monotonicityR2: monotonicityR2(segmentMeanReturnPct),
      longShortSpreadPct:
        segmentMeanReturnPct.length >= 2
          ? +(segmentMeanReturnPct[0] - segmentMeanReturnPct[segmentMeanReturnPct.length - 1]).toFixed(4)
          : 0,
      periodCount: icSeries.length,
    };
  }

  async runFactorCorrelation(input: FactorCorrelationInput): Promise<FactorCorrelationOutput> {
    if (input.refs.length < 2 || input.refs.length > 10) {
      throw new ApiException('INVALID_ARGUMENT', 400, `因子个数须为 2~10（两两相关）: ${input.refs.length}`);
    }
    const factors = input.refs.map((r) => `${r.table}.${r.field}`);
    if (new Set(factors).size !== factors.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, `因子重复: ${factors.join(', ')}`);
    }
    if (!Number.isInteger(input.intervalDays) || input.intervalDays < 1 || input.intervalDays > 250) {
      throw new ApiException('INVALID_ARGUMENT', 400, `intervalDays 须为 1~250 的整数（采样间隔，交易日）: ${input.intervalDays}`);
    }

    // ① 日历（首个因子表作日历源；不同表日历不一致时按交集近似——采样日取并集表可能有值差异，缺值剔除已兜底）
    const coverage = await this.factorData.readTradeDates(input.refs[0].table, input.startDate, input.endDate);
    if (Number(input.startDate) < coverage.min || Number(input.endDate) > coverage.max) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `分析区间超出数据范围：${input.refs[0].table} 可用区间 ${coverage.min}~${coverage.max}，请调整 startDate/endDate`,
      );
    }
    const tradeDates = coverage.dates;
    const sampleIdx = tradeDates.map((_, i) => i).filter((i) => i % input.intervalDays === 0);
    if (!sampleIdx.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, `区间 ${input.startDate}~${input.endDate} 内无可用采样日，请调整区间或 intervalDays`);
    }

    // ② 逐采样期取各因子截面
    const periodValues: Map<string, Map<string, number>>[] = [];
    for (const idx of sampleIdx) {
      const date = String(tradeDates[idx]);
      const sections = await Promise.all(
        input.refs.map((ref) => this.factorData.readFactorSection(ref.table, ref.field, date, input.securityIds ?? null)),
      );
      const perFactor = new Map<string, Map<string, number>>();
      input.refs.forEach((ref, i) => {
        perFactor.set(`${ref.table}.${ref.field}`, new Map(sections[i].map((r) => [r.securityId, r.value] as const)));
      });
      periodValues.push(perFactor);
    }

    // ③ 两两 Spearman（公共股票自动配对、缺值剔除），逐期计算后取均值
    const n = input.refs.length;
    const sums: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const counts: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    for (const perFactor of periodValues) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const rho = spearmanOnCrossSection(perFactor.get(factors[i])!, perFactor.get(factors[j])!);
          if (rho === undefined) continue;
          sums[i][j] += rho;
          counts[i][j]++;
          sums[j][i] = sums[i][j];
          counts[j][i] = counts[i][j];
        }
      }
    }
    const matrix: (number | null)[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        if (i === j) return 1;
        return counts[i][j] > 0 ? +(sums[i][j] / counts[i][j]).toFixed(4) : null;
      }),
    );
    return { factors, matrix, periodCount: periodValues.length };
  }

  /** 因子画像：单因子截面基础统计（覆盖 + 分布分位 + 分档均值），只读零副作用 */
  async describeFactor(input: FactorProfileInput): Promise<FactorProfileOutput> {
    // ① 日历（因子表作日历源）：缺省/非交易日自动回落到 ≤ date 的最近交易日
    const coverage = await this.factorData.readTradeDates(input.table, '19000101', '20991231');
    if (!coverage.dates.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, `因子表 ${input.table} 无任何交易日数据`);
    }
    let date = Number(input.date ?? coverage.dates.at(-1));
    if (date < coverage.min) {
      throw new ApiException('INVALID_ARGUMENT', 400, `截面日早于数据范围：${input.table} 数据起点 ${coverage.min}`);
    }
    // 超出 max 的日期（未来/节假日）回落到 ≤ date 的最近交易日（与 run_daily_screen 同口径）
    if (!coverage.dates.includes(date)) {
      const fallback = coverage.dates.filter((d) => d <= date).at(-1);
      if (fallback === undefined) {
        throw new ApiException('INVALID_ARGUMENT', 400, `截面日 ${date} 早于 ${input.table} 数据起点 ${coverage.min}`);
      }
      date = fallback; // 非交易日回落前一交易日（与 run_daily_screen 同口径）
    }

    // ② 截面读数 → 分布统计（只留有限数值）
    const section = await this.factorData.readFactorSection(
      input.table,
      input.field,
      String(date),
      input.securityIds ?? null,
    );
    const values = section
      .map((r) => r.value)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!values.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, `因子截面为空（${input.table}.${input.field} 在 ${date} 无任何股票有值），请调整因子/股票池/日期`);
    }

    const n = values.length;
    const mean = values.reduce((s, x) => s + x, 0) / n;
    const std = Math.sqrt(values.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
    const quant = (p: number) => quantileAt(values, p);

    return {
      table: input.table,
      field: input.field,
      date,
      dataRange: { min: coverage.min, max: coverage.max },
      stockCount: n,
      stats: {
        min: values[0],
        p10: quant(0.1),
        p25: quant(0.25),
        median: quant(0.5),
        p75: quant(0.75),
        p90: quant(0.9),
        max: values[n - 1],
        mean: +mean.toFixed(4),
        std: +std.toFixed(4),
      },
      buckets: bucketMeansOf(values, 5),
    };
  }
}
