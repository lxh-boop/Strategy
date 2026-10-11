import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { BacktestCard, RawMetrics } from '../types';
import { maxDrawdownPct, toMetricItems } from './backtest.service';
import { CrossSectionRow } from './factor-data.service';

/* ==========================================================
   等权回测接口（契约层）—— 定义"选完因子后一步等权回测出卡片能做什么"。
   实现：implementations/equal-weight-backtest.service.impl.ts
   （纯编排与计算：数据经 FactorDataService 的批量方法取数，本层不触库、不建连接）

   口径（v1，多因子等权合成）：
   - 调仓日在调仓周期内最后一个有因子数据的交易日建仓：各因子先算当日截面
     分位数，等权平均成综合分，按综合分取 Top-K 等权持有（因子可各自指定方向）；
   - 持有期内日度等权再平衡：组合日收益 = 持仓个股日收益的等权平均；
   - 个股日收益 = 前复权收盘相邻日相除 - 1（含分红送转配股）；
     个股当日缺行情按 0 收益计入等权分母；
   - 换手率：调仓日单边换手 = (上期持仓数 - 两期重叠数) / 上期持仓数，
     年化 = 各期平均 × 每年调仓期数（按实际频率折算），未计交易费用；
   - 曲线起点 100；年化/夏普按 252 个交易日折算，无风险利率 0。
   ========================================================== */

/* ----- 调仓频率（8 档枚举 + 自定义间隔；必填，无默认值） ----- */

export type BacktestFrequency =
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'custom';

/** 频率 → 中文标签（卡片 tag / 工具摘要用） */
export const FREQUENCY_LABELS: Record<BacktestFrequency, string> = {
  daily: '每日',
  weekly: '每周',
  biweekly: '每半月',
  monthly: '每月',
  quarterly: '每季',
  semiannual: '每半年',
  annual: '每年',
  custom: '自定义',
};

/** custom 档的每 N 个交易日调仓约束：下限 5（2~4 个交易日 v1 不做，更频场景用 daily 档），上限 120 */
export const EVERY_N_TD_MIN = 5;
export const EVERY_N_TD_MAX = 120;

/** daily 档调仓期数上限（约两年交易日）：逐日全截面取数为 期数×因子数 次查询，超限耗时不可控 */
export const DAILY_MAX_REBALANCES = 550;

/* ----- 其余参数 ----- */

export type FactorOrder = 'desc' | 'asc';
export type BenchmarkKey = 'hs300' | 'csi500' | 'sse';

/** 归一化后的单因子：表 + 字段 + 方向（desc 值越大越好 / asc 值越小越好） */
export interface BacktestFactor {
  table: string;
  field: string;
  order: FactorOrder;
}

/** 参与合成的因子数上限（截面分位等权合成的规模约束） */
export const MAX_FACTORS = 10;

/** 基准 → 指数代码与中文名（mkt_idxd.TICKER_SYMBOL） */
export const BENCHMARKS: Record<BenchmarkKey, { ticker: string; name: string }> = {
  hs300: { ticker: '000300', name: '沪深300' },
  csi500: { ticker: '000905', name: '中证500' },
  sse: { ticker: '000001', name: '上证指数' },
};

/** 每期持仓只数：默认 50，限 1~200 */
export const TOP_K_DEFAULT = 50;
export const TOP_K_MAX = 200;

/** 工具入参（LLM 传入，字段均为未知形态，服务端归一化校验） */
export interface EqualWeightBacktestInput {
  /** 参与合成的因子数组，每项 {table, field, order?}，1~10 个 */
  factors?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  /** 调仓频率：必填，无默认值，缺失直接报错 */
  frequency?: unknown;
  /** frequency='custom' 时必填：每 N 个交易日调仓，5~120 */
  everyNTd?: unknown;
  topK?: unknown;
  benchmark?: unknown;
}

/** 归一化后的合法入参 */
export interface NormalizedBacktestInput {
  factors: BacktestFactor[];
  startDate: string;
  endDate: string;
  frequency: BacktestFrequency;
  everyNTd?: number;
  topK: number;
  benchmark: BenchmarkKey;
}

/** 回测产物：前端卡片 + 给 LLM 的文字摘要（卡片绕过 LLM，摘要只含指标数字） */
export interface EqualWeightBacktestOutput {
  card: BacktestCard;
  summary: Record<string, unknown>;
}

/* ----- 入参归一化与校验（纯函数；字典白名单由实现层补一道） ----- */

/** 工具澄清信号：不是入参错误，而是"需要模型向用户追问"的场景。
 *  guide 即返回给模型的工具回执（非 error 形态），由 agent 层统一兜底原样转发，
 *  引导模型向用户提问而不是把报错转述给用户。 */
export class ClarificationSignal extends Error {
  constructor(/** 返回给模型的澄清指引 */ readonly guide: Record<string, unknown>) {
    super('需要用户澄清后再执行');
    this.name = 'ClarificationSignal';
  }
}

const FREQUENCY_VALUES = Object.keys(FREQUENCY_LABELS) as BacktestFrequency[];

const FREQUENCY_HINT =
  '可选值 daily（每日）/ weekly（每周）/ biweekly（每半月）/ monthly（每月）/ quarterly（每季）/' +
  ' semiannual（每半年）/ annual（每年）/ custom（自定义，每 N 个交易日，需同时传 everyNTd）。' +
  '用户未指明调仓频率时请先向用户询问，不要自行假设。';

/** 归一化 + 格式校验；非法入参抛 INVALID_ARGUMENT。frequency 缺失必报错（无默认值）。 */
export function assertBacktestInput(raw: EqualWeightBacktestInput): NormalizedBacktestInput {
  const startDate = String(raw.startDate ?? '').trim();
  const endDate = String(raw.endDate ?? '').trim();

  // factors：多因子等权合成（1~10 个，每项 {table, field, order?}）
  const rawFactors = raw.factors;
  if (!Array.isArray(rawFactors) || rawFactors.length === 0) {
    throw new ApiException(
      'INVALID_ARGUMENT',
      400,
      '参数不完整：需要 factors（因子数组，至少 1 个，每项 {table 因子表名, field 因子字段名, order? 方向}，最多 10 个）、' +
        'startDate/endDate（纯数字 YYYYMMDD）、frequency（调仓频率）。表与字段名请先通过 list_factor_tables / list_factor_fields 获取',
    );
  }
  if (rawFactors.length > MAX_FACTORS) {
    throw new ApiException('INVALID_ARGUMENT', 400, `factors 过多（${rawFactors.length} 个，最多 ${MAX_FACTORS} 个）`);
  }
  const factors: BacktestFactor[] = [];
  const seen = new Set<string>();
  for (const item of rawFactors) {
    const o = (item ?? {}) as Record<string, unknown>;
    const table = String(o.table ?? '').trim();
    const field = String(o.field ?? '').trim();
    if (!table || !field) {
      throw new ApiException('INVALID_ARGUMENT', 400, `factors 每项都需要 table 与 field: ${JSON.stringify(item)}`);
    }
    const order = (o.order === undefined || o.order === null || o.order === '' ? 'desc' : String(o.order)) as FactorOrder;
    if (order !== 'desc' && order !== 'asc') {
      throw new ApiException('INVALID_ARGUMENT', 400, `factors[].order 只允许 desc（值越大越好）或 asc（值越小越好）: ${String(o.order)}`);
    }
    const key = `${table}.${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      factors.push({ table, field, order });
    }
  }

  if (!startDate || !endDate) {
    throw new ApiException('INVALID_ARGUMENT', 400, '参数不完整：需要 startDate/endDate（纯数字 YYYYMMDD）');
  }
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || Number(startDate) >= Number(endDate)) {
    throw new ApiException('INVALID_ARGUMENT', 400, `回测区间非法：startDate/endDate 须为纯数字 YYYYMMDD 且 start 早于 end，当前 ${startDate} ~ ${endDate}`);
  }

  // 调仓频率：必填，无默认值；缺失抛澄清信号（由模型向用户追问），非法枚举才是入参错误
  if (raw.frequency === undefined || raw.frequency === null || String(raw.frequency).trim() === '') {
    throw new ClarificationSignal({
      需要澄清: '调仓频率 frequency（必填，无默认值）',
      可选值:
        'daily 每日 / weekly 每周 / biweekly 每半月 / monthly 每月 / quarterly 每季 / semiannual 每半年 / annual 每年 / ' +
        'custom 每 N 个交易日（需同时传 everyNTd，5~120）',
      行动: '不要把本回执当错误转述给用户；请直接向用户询问期望的调仓频率，等用户答复后再调用本工具',
    });
  }
  const frequency = String(raw.frequency).trim() as BacktestFrequency;
  if (!FREQUENCY_VALUES.includes(frequency)) {
    throw new ApiException('INVALID_ARGUMENT', 400, `frequency 非法: ${frequency}。${FREQUENCY_HINT}`);
  }

  let everyNTd: number | undefined;
  if (frequency === 'custom') {
    everyNTd = Number(raw.everyNTd);
    if (!raw.everyNTd && raw.everyNTd !== 0) {
      throw new ApiException('INVALID_ARGUMENT', 400, `frequency=custom 时必须同时传 everyNTd（每 N 个交易日调仓一次，${EVERY_N_TD_MIN}~${EVERY_N_TD_MAX}）`);
    }
    if (!Number.isInteger(everyNTd) || (everyNTd as number) < EVERY_N_TD_MIN || (everyNTd as number) > EVERY_N_TD_MAX) {
      throw new ApiException('INVALID_ARGUMENT', 400, `everyNTd 必须是 ${EVERY_N_TD_MIN}~${EVERY_N_TD_MAX} 的整数（过小会退化为日度调仓且查询超时）: ${raw.everyNTd}`);
    }
  } else if (raw.everyNTd !== undefined && raw.everyNTd !== null && raw.everyNTd !== '') {
    throw new ApiException('INVALID_ARGUMENT', 400, 'frequency 非 custom 时不要传 everyNTd（自定义间隔仅 custom 支持）');
  }

  let topK = raw.topK === undefined || raw.topK === null || raw.topK === '' ? TOP_K_DEFAULT : Number(raw.topK);
  if (!Number.isInteger(topK) || topK < 1 || topK > TOP_K_MAX) {
    throw new ApiException('INVALID_ARGUMENT', 400, `topK 必须是 1~${TOP_K_MAX} 的整数: ${raw.topK}`);
  }

  const benchmark = (raw.benchmark === undefined || raw.benchmark === null || raw.benchmark === '' ? 'hs300' : String(raw.benchmark)) as BenchmarkKey;
  if (!(benchmark in BENCHMARKS)) {
    throw new ApiException('INVALID_ARGUMENT', 400, `benchmark 只允许 hs300（沪深300）/ csi500（中证500）/ sse（上证指数）: ${raw.benchmark}`);
  }

  return { factors, startDate, endDate, frequency, everyNTd, topK, benchmark };
}

/* ----- 回测区间溯源校验（纯函数） -----
 * 策略 A：startDate/endDate 属"用户必填"参数——只能来自用户在对话中明确说过的时间
 * （本轮或本会话早先轮次均可，即会话继承），模型凭经验补全的区间在服务端拦截。
 * prompt/schema 描述是软约束，这里是硬保证；匹配取向"宁可漏放不可错杀"：
 * 多日期格式/年份/相对时长/日历词宽松归一化，漏放的由最终文案的参数来源声明兜底可见。 */

/** 中文数字 → 数值（相对时长解析用；"十二"类组合单独处理） */
const CN_NUMERAL: Record<string, number> = {
  一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
};

/** 解析相对时长里的数量（阿拉伯数字/中文数字/"十二"组合），无法解析返回 0 */
function parseCount(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (CN_NUMERAL[raw] !== undefined) return CN_NUMERAL[raw];
  const combo = /^([一二两三四五六七八九])十([一二三四五六七八九])?$/.exec(raw);
  return combo ? CN_NUMERAL[combo[1]] * 10 + (combo[2] ? CN_NUMERAL[combo[2]] : 0) : 0;
}

/** 8 位日期 → UTC 天序号（跨度计算用，不依赖宿主对 YYYYMMDD 的解析行为） */
function dayNumber(d: string): number {
  return Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8))) / 86_400_000;
}

/** 端点日期的字面命中：YYYYMMDD、2024-01-01、2024/1/1、2024.1.1、2024年1月(1日)、202401 */
function dateLiteralHit(d: string, text: string): boolean {
  const y = d.slice(0, 4);
  const mm = d.slice(4, 6);
  const dd = d.slice(6, 8);
  const mN = String(Number(mm));
  const dN = String(Number(dd));
  const forms = [
    d,
    `${y}-${mm}-${dd}`, `${y}-${mN}-${dN}`,
    `${y}/${mm}/${dd}`, `${y}/${mN}/${dN}`,
    `${y}.${mm}.${dd}`, `${y}.${mN}.${dN}`,
    `${y}年${mm}月${dd}日`, `${y}年${mN}月${dN}日`, `${y}年${mN}月`,
    d.slice(0, 6),
  ];
  return forms.some((f) => text.includes(f));
}

/**
 * 回测区间出处判定：用户话语中存在能覆盖 [startDate, endDate] 的时间表达时返回 true。
 * userUtterances 传本会话全部用户消息（含当前轮）——"会话继承"由此天然成立。
 * 四条命中规则，任一命中即放行：
 *   ① 起止两端的日期字面命中（多格式）；
 *   ② 用户提过的年份覆盖起止两年（"2024 全年"/"2023 到 2025"）；
 *   ③ 相对时长（近 N 年/近半年/近 N 个月）且实际跨度不超过表达上限（宽放 ~3%）；
 *   ④ 日历词：今年/去年/前年按当前时间折算；裸"上/下半年"按两端同处一个半年。
 */
export function hasBacktestDateProvenance(
  startDate: string,
  endDate: string,
  userUtterances: string[],
  now: Date = new Date(),
): boolean {
  const text = userUtterances.join('\n');
  if (!text.trim()) return false;

  if (dateLiteralHit(startDate, text) && dateLiteralHit(endDate, text)) return true;

  const mentionedYears = new Set(text.match(/(?:19|20)\d{2}(?!\d)/g) ?? []);
  if (mentionedYears.has(startDate.slice(0, 4)) && mentionedYears.has(endDate.slice(0, 4))) return true;

  let spanCap = 0;
  for (const m of text.matchAll(/(?:近|最近|过去|这)\s*([0-9]+|[一二两三四五六七八九十]+)\s*年/g)) {
    spanCap = Math.max(spanCap, parseCount(m[1]) * 370 + 15);
  }
  for (const m of text.matchAll(/(?:近|最近|过去|这)\s*([0-9]+|[一二两三四五六七八九十]+)\s*个?\s*月/g)) {
    spanCap = Math.max(spanCap, parseCount(m[1]) * 32 + 10);
  }
  if (/(?:近|最近|过去|这)\s*半年/.test(text)) spanCap = Math.max(spanCap, 200);
  if (spanCap > 0 && dayNumber(endDate) - dayNumber(startDate) <= spanCap) return true;

  const nowY = now.getFullYear();
  const startY = Number(startDate.slice(0, 4));
  const endY = Number(endDate.slice(0, 4));
  const bothInYear = (yy: number) => startY === yy && endY === yy;
  if (bothInYear(nowY) && /今年/.test(text)) return true;
  if (bothInYear(nowY - 1) && /去年/.test(text)) return true;
  if (bothInYear(nowY - 2) && /前年/.test(text)) return true;
  if (/(?:上|下)半年/.test(text) && startY === endY) {
    const inUpper = (mm: number) => mm >= 1 && mm <= 6;
    if (inUpper(Number(startDate.slice(4, 6))) === inUpper(Number(endDate.slice(4, 6)))) return true;
  }
  return false;
}

/* ----- 多因子等权合成选股（纯函数） ----- */

/**
 * 各因子截面 → 分位数等权合成 → 按综合分取前 k 个证券代码。
 * 口径：每个因子在当日截面上按因子值升序算分位数（(排名)/n，0~1]；
 * order=desc 直接用分位数（值越大分位越高），order=asc 取 1-分位数（值越小越好）；
 * 个股综合分 = 其可得因子分位数的等权平均（缺某因子就少算一项，全部缺失则不入选）。
 */
export function compositeTopK(factors: BacktestFactor[], sections: CrossSectionRow[][], k: number): string[] {
  const scoreSum = new Map<string, number>();
  const scoreCnt = new Map<string, number>();
  factors.forEach((factor, i) => {
    const rows = [...(sections[i] ?? [])].sort((a, b) => a.value - b.value);
    const n = rows.length;
    if (!n) return;
    rows.forEach((row, idx) => {
      const pct = (idx + 1) / n;
      const score = factor.order === 'asc' ? 1 - pct : pct;
      scoreSum.set(row.securityId, (scoreSum.get(row.securityId) ?? 0) + score);
      scoreCnt.set(row.securityId, (scoreCnt.get(row.securityId) ?? 0) + 1);
    });
  });
  const composite = [...scoreSum.entries()].map(([securityId, sum]) => ({
    securityId,
    score: sum / (scoreCnt.get(securityId) as number),
  }));
  composite.sort((a, b) => b.score - a.score);
  return composite.slice(0, Math.max(0, k)).map((c) => c.securityId);
}

/* ----- 调仓日生成（纯函数） ----- */

/** 交易日（升序）按调仓频率分组，取每组最后一个交易日为调仓日。
 *  daily 每个交易日都是调仓日；weekly 按自然周（周一为一周起点）；
 *  biweekly 按日历半月（每月 15 日含前/后）；custom 按每 everyNTd 个交易日切一组。 */
export function groupRebalanceDates(dates: number[], frequency: BacktestFrequency, everyNTd?: number): number[] {
  if (!dates.length) return [];
  const lastOfGroup = new Map<string, number>();
  if (frequency === 'custom') {
    const n = everyNTd as number;
    dates.forEach((d, i) => lastOfGroup.set(String(Math.floor(i / n)), d));
  } else {
    for (const d of dates) lastOfGroup.set(periodKey(d, frequency), d);
  }
  return [...lastOfGroup.values()];
}

/** 调仓周期分组键：单调递增即可，组内最后写入的日期即调仓日 */
function periodKey(d: number, frequency: BacktestFrequency): string {
  const y = Math.floor(d / 10000);
  const m = Math.floor(d / 100) % 100;
  const day = d % 100;
  switch (frequency) {
    case 'daily':
      return String(d);
    case 'weekly':
      return mondayKey(y, m, day);
    case 'biweekly':
      return `${y}${String(m).padStart(2, '0')}-${day <= 15 ? 'A' : 'B'}`;
    case 'monthly':
      return `${y}${String(m).padStart(2, '0')}`;
    case 'quarterly':
      return `${y}Q${Math.ceil(m / 3)}`;
    case 'semiannual':
      return `${y}H${m <= 6 ? 1 : 2}`;
    case 'annual':
      return String(y);
    default:
      throw new ApiException('INVALID_ARGUMENT', 400, `未支持的调仓频率: ${frequency}`);
  }
}

/** 该日期所在周的周一（YYYYMMDD），周起点取周一 */
function mondayKey(y: number, m: number, day: number): string {
  const utc = Date.UTC(y, m - 1, day);
  const monday = new Date(utc - ((new Date(utc).getUTCDay() + 6) % 7) * 86_400_000);
  return `${monday.getUTCFullYear()}${String(monday.getUTCMonth() + 1).padStart(2, '0')}${String(monday.getUTCDate()).padStart(2, '0')}`;
}

/** YYYYMMDD → 'YYYY-MM-DD'（行情表 DATE 列参数与收盘 Map 的键） */
export function toDashDate(yyyymmdd: number): string {
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/* ----- 绩效聚合（纯函数） ----- */

/** 聚合产物 */
export interface BacktestAggregate {
  /** 组合净值曲线（起点 100，2 位小数） */
  curve: number[];
  /** 基准净值曲线（同起点同交易日） */
  benchCurve: number[];
  /** 年化收益 / 最大回撤 / 夏普 / 胜率（百分比口径：14.6 即 14.6%） */
  metrics: RawMetrics;
  /** 年化换手（单边，%） */
  annualTurnoverPct: number;
  /** 基准年化收益（%） */
  benchAnnual: number;
}

/**
 * 由日收益序列聚合并展示指标。
 * @param returns        组合日收益序列（与交易日一一对应）
 * @param benchReturns   基准日收益序列（与 returns 同长对齐；缺行情按 0）
 * @param turnovers      各调仓期单边换手率（0~1）
 * @param periodsPerYear 每年调仓期数（调仓期数 ÷ 年数，按实际频率折算）
 */
export function aggregatePerformance(
  returns: number[],
  benchReturns: number[],
  turnovers: number[],
  periodsPerYear: number,
): BacktestAggregate {
  const curve = compound(returns);
  const benchCurve = compound(benchReturns);
  const n = returns.length;
  const years = n / 252;
  const end = curve[curve.length - 1] ?? 100;
  const benchEnd = benchCurve[benchCurve.length - 1] ?? 100;
  const annual = n && years > 0 && end > 0 ? (Math.pow(end / 100, 1 / years) - 1) * 100 : 0;
  const benchAnnual = n && years > 0 && benchEnd > 0 ? (Math.pow(benchEnd / 100, 1 / years) - 1) * 100 : 0;

  const mean = n ? returns.reduce((a, r) => a + r, 0) / n : 0;
  const variance = n > 1 ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / n : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 1e-12 ? (mean / std) * Math.sqrt(252) : 0;
  const winRate = n ? (returns.filter((r) => r > 0).length / n) * 100 : 0;

  const avgTurnover = turnovers.length ? turnovers.reduce((a, t) => a + t, 0) / turnovers.length : 0;

  return {
    curve,
    benchCurve,
    metrics: { annual: round2(annual), drawdown: maxDrawdownPct(curve), sharpe: round2(sharpe), winRate: round2(winRate) },
    annualTurnoverPct: round2(avgTurnover * periodsPerYear * 100),
    benchAnnual: round2(benchAnnual),
  };
}

/** 日收益 → 净值曲线（起点 100，保留 2 位小数） */
function compound(returns: number[]): number[] {
  let nav = 100;
  return returns.map((r) => +(nav *= 1 + r).toFixed(2));
}

function round2(v: number): number {
  return +v.toFixed(2);
}

/* ----- 契约 ----- */

/**
 * 等权回测：输入已选定的因子（表 + 字段）与回测参数，输出前端回测卡片与给模型的摘要。
 * 内存口径：逐年拉取"当年持仓并集"的行情，任一时刻在内存中的只有一年数据。
 */
@Injectable()
export abstract class EqualWeightBacktestService {
  abstract runEqualWeightBacktest(input: EqualWeightBacktestInput): Promise<EqualWeightBacktestOutput>;

  /** 执行前快检（实现层做字典白名单校验）：确认门在 interrupt 之前调用，
   *  让"字段不存在"这类注定失败的提案在用户确认前就被打回给模型自纠，
   *  避免用户确认一轮之后引擎才报错、又得重新确认一轮 */
  abstract preflight(factors: BacktestFactor[]): void;
}

/** 指标数组组装（供实现层拼卡片 metrics：四项绩效 + 年化换手） */
export function toBacktestMetricItems(agg: BacktestAggregate): { label: string; value: string; cls?: string }[] {
  return [
    ...toMetricItems(agg.metrics),
    { label: '年化换手(单边)', value: formatPct(agg.annualTurnoverPct, 0), cls: '' },
  ];
}

/** +12.3% / -4.5% 形态的百分比展示 */
export function formatPct(v: number, digits = 1): string {
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%';
}
