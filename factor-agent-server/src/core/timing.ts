import { ApiException } from '../common/api.exception';
import { BENCHMARKS, type BenchmarkKey, type FactorRef } from './strategy-backtest.service';

/* ==========================================================
   大盘择时构件（共享库，模型 Ⅰ/Ⅱ 引擎通用）—— 果仁语义的等价实现
   （逆向依据：《果仁择时逆向.md》§1 择时条件设定对话框）

   - 择时条件 = 白名单字段 + 牛熊区分规则：条件当日成立投"牛"票、不成立投"熊"票，
     字段缺值弃权（不计分母）——与 entryFilters/sellRules 同构，引擎不在线计算任何衍生指标；
   - 全局牛熊 = 带滞回的投票状态机（果仁原文："同时满足 N 个择时条件由熊变牛，
     同时满足 M 个由牛变熊"）：牛→熊需 ≥exitVotes 张熊票、熊→牛需 ≥enterVotes 张牛票，
     -1 = 需全部规则；初始状态 = 牛；
   - 仓位映射：牛市 100%，熊市 bearPositionPct%（分级，默认 0=空仓）；
   - 职责边界：本模块只做"字段值 → 条件判定 → 投票 → 状态机 → 目标仓位"的纯函数，
     序列读取由引擎经 FactorDataService 完成，白名单校验由实现层 assertWhitelist 兜底。
   ========================================================== */

/** 择时条件操作符白名单（导出常量：后续追加 'xup'/'xdn' 上穿/下穿只改这里与判定函数，config 无迁移） */
export const TIMING_OPS = ['>', '<', 'bw'] as const;
export type TimingOp = (typeof TIMING_OPS)[number];

/** 择时规则条数上限（果仁 selfTimingLimit=1 更紧，这里放宽到 3 条投票组合） */
export const TIMING_RULES_MAX = 3;
/** 熊市仓位缺省：空仓（对齐果仁 stock-bear-space 默认值 "0"） */
export const TIMING_BEAR_PCT_DEFAULT = 0;
/** 择时默认指数：上证（对齐果仁 TimingIndexDefault="000001"） */
export const TIMING_INDEX_DEFAULT: BenchmarkKey = 'sse';

/** 单条择时条件：白名单日期表字段 + 牛熊区分规则（条件成立=牛票，不成立=熊票） */
export interface TimingConditionRule {
  table: string;
  field: string;
  op: TimingOp;
  /** op='>' / '<' 时的比较阈值（必填） */
  value?: number;
  /** op='bw' 的区间下/上限（必填，low < high） */
  low?: number;
  high?: number;
}

/** 择时叠加配置（归一化形态）：规则投票 → 牛熊状态机 → 熊市仓位 */
export interface StrategyTimingOverlay {
  /** 挂靠指数（字段序列按该指数的代码读取，默认上证） */
  index: BenchmarkKey;
  /** 条件组（1~3 条，逐日投票） */
  rules: TimingConditionRule[];
  /** 熊转牛所需牛票数：1~rules.length，-1=全部；默认 -1 */
  enterVotes: number;
  /** 牛转熊所需熊票数：1~rules.length，-1=全部；默认 -1 */
  exitVotes: number;
  /** 熊市总仓位 %（0~100 整数，牛市恒为 100）；默认 0=空仓 */
  bearPositionPct: number;
}

export type TimingRegime = 'bull' | 'bear';

/* ----- 归一化与校验（纯函数；字典白名单由实现层补一道） ----- */

/** 归一化 + 校验；未传返回 undefined。非法入参抛 INVALID_ARGUMENT（与 assertFilters 同风格）。 */
export function assertTimingOverlay(raw: unknown): StrategyTimingOverlay | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o !== 'object' || Array.isArray(o)) {
    throw new ApiException('INVALID_ARGUMENT', 400, 'timingOverlay 必须是对象 {index, rules, enterVotes, exitVotes, bearPositionPct}');
  }

  const index = (o.index === undefined || o.index === null || o.index === '' ? TIMING_INDEX_DEFAULT : String(o.index)) as BenchmarkKey;
  if (!(index in BENCHMARKS)) {
    throw new ApiException('INVALID_ARGUMENT', 400, `timingOverlay.index 只允许 hs300（沪深300）/ csi500（中证500）/ sse（上证指数）: ${String(o.index)}`);
  }

  if (!Array.isArray(o.rules) || o.rules.length === 0) {
    throw new ApiException('INVALID_ARGUMENT', 400, 'timingOverlay.rules 必须是非空数组（1~3 条条件），每项 {table, field, op, value | low/high}');
  }
  if (o.rules.length > TIMING_RULES_MAX) {
    throw new ApiException('INVALID_ARGUMENT', 400, `timingOverlay.rules 过多（${o.rules.length} 条，最多 ${TIMING_RULES_MAX} 条）`);
  }
  const rules: TimingConditionRule[] = o.rules.map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const table = String(r.table ?? '').trim();
    const field = String(r.field ?? '').trim();
    const op = String(r.op ?? '').trim() as TimingOp;
    if (!table || !field) {
      throw new ApiException('INVALID_ARGUMENT', 400, `timingOverlay.rules 每项都需要 table 与 field: ${JSON.stringify(item)}`);
    }
    if (!(TIMING_OPS as readonly string[]).includes(op)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `timingOverlay.rules[].op 只允许 ${TIMING_OPS.join('/')}: ${op}`);
    }
    if (op === 'bw') {
      const low = Number(r.low);
      const high = Number(r.high);
      if (!Number.isFinite(low) || !Number.isFinite(high) || low >= high) {
        throw new ApiException('INVALID_ARGUMENT', 400, `timingOverlay.rules bw 区间须为有限数字且 low < high: ${JSON.stringify(item)}`);
      }
      return { table, field, op, low, high };
    }
    const value = Number(r.value);
    if (!Number.isFinite(value)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `timingOverlay.rules[].value 须为有限数字: ${JSON.stringify(item)}`);
    }
    return { table, field, op: op as '>' | '<', value };
  });

  const voteOf = (v: unknown, label: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || (n !== -1 && (n < 1 || n > rules.length))) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `timingOverlay.${label} 须为 -1（需全部条件）或 1~${rules.length} 的整数: ${String(v)}`,
      );
    }
    return n;
  };
  const enterVotes = o.enterVotes === undefined || o.enterVotes === null || o.enterVotes === ''
    ? -1
    : voteOf(o.enterVotes, 'enterVotes');
  const exitVotes = o.exitVotes === undefined || o.exitVotes === null || o.exitVotes === ''
    ? -1
    : voteOf(o.exitVotes, 'exitVotes');

  const bearPositionPct = o.bearPositionPct === undefined || o.bearPositionPct === null || o.bearPositionPct === ''
    ? TIMING_BEAR_PCT_DEFAULT
    : Number(o.bearPositionPct);
  if (!Number.isInteger(bearPositionPct) || bearPositionPct < 0 || bearPositionPct > 100) {
    throw new ApiException('INVALID_ARGUMENT', 400, `timingOverlay.bearPositionPct 须为 0~100 的整数（熊市保留仓位 %）: ${String(o.bearPositionPct)}`);
  }

  return { index, rules, enterVotes, exitVotes, bearPositionPct };
}

/** 择时引用的字段集合（白名单快检与日历推导共用；表须含 TRADE_DATE 的日期表） */
export function collectTimingRefs(overlay: StrategyTimingOverlay): FactorRef[] {
  const out: FactorRef[] = [];
  const seen = new Set<string>();
  for (const r of overlay.rules) {
    const key = `${r.table}.${r.field}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ table: r.table, field: r.field });
    }
  }
  return out;
}

/** 择时配置 → 展示串（确认门/卡片/摘要同源）。例：
 *  `上证指数：mkt_idxd.CLOSE_INDEX > 3000；熊转牛需全部条件、牛转熊需2个条件；熊市仓位空仓` */
export function describeTimingOverlay(o: StrategyTimingOverlay): string {
  const indexName = BENCHMARKS[o.index].name;
  const ruleText = o.rules
    .map((r) => (r.op === 'bw' ? `${r.table}.${r.field} ∈ [${r.low}, ${r.high}]` : `${r.table}.${r.field} ${r.op} ${r.value}`))
    .join(' 且 ');
  const votes = (n: number, label: string) => (n === -1 ? `需全部条件${label}` : `需 ${n} 个条件${label}`);
  const bear = o.bearPositionPct === 0 ? '空仓' : `${o.bearPositionPct}%`;
  return `${indexName}：${ruleText}；${votes(o.enterVotes, '由熊转牛')}、${votes(o.exitVotes, '由牛转熊')}；熊市仓位 ${bear}`;
}

/* ----- 条件判定与投票状态机（纯函数，模型 Ⅰ/Ⅱ 引擎共用） ----- */

/** 单条条件在 D 日的判定：值缺失返回 undefined（弃权），否则布尔。 */
export function evalTimingCondition(value: number | undefined, rule: TimingConditionRule): boolean | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  if (rule.op === '>') return value > (rule.value as number);
  if (rule.op === '<') return value < (rule.value as number);
  return value >= (rule.low as number) && value <= (rule.high as number);
}

export interface TimingDayVotes {
  /** 条件成立的规则数（牛票） */
  bull: number;
  /** 条件不成立的规则数（熊票） */
  bear: number;
  /** 缺值弃权的规则数（不计分母） */
  abstain: number;
}

/** 逐规则投票：values 与 overlay.rules 一一对应（缺值 = undefined） */
export function voteTiming(overlay: StrategyTimingOverlay, values: (number | undefined)[]): TimingDayVotes {
  let bull = 0;
  let bear = 0;
  let abstain = 0;
  overlay.rules.forEach((rule, i) => {
    const v = evalTimingCondition(values[i], rule);
    if (v === true) bull++;
    else if (v === false) bear++;
    else abstain++;
  });
  return { bull, bear, abstain };
}

/**
 * 状态机推进（D 日收盘后的意见 → D 日收盘后的状态；目标仓位 D+1 生效）。
 * 阈值 -1 = 需全部规则投票；弃权票不计入分母（等于天然抬高中票门槛）。
 */
export function nextTimingRegime(
  prev: TimingRegime,
  votes: TimingDayVotes,
  overlay: StrategyTimingOverlay,
): TimingRegime {
  const required = (n: number) => (n === -1 ? overlay.rules.length : n);
  if (prev === 'bull') {
    return votes.bear >= required(overlay.exitVotes) ? 'bear' : 'bull';
  }
  return votes.bull >= required(overlay.enterVotes) ? 'bull' : 'bear';
}

/** 状态 → 当日目标总仓位 %：牛市满仓，熊市保留 bearPositionPct */
export function exposureOfRegime(regime: TimingRegime, overlay: StrategyTimingOverlay): number {
  return regime === 'bull' ? 100 : overlay.bearPositionPct;
}

/* ----- 择时统计（卡片三件套） ----- */

export interface PositionDistBucket {
  /** 展示名：0%(空仓) / 1-25% / 26-50% / 51-75% / 76-99% / 100%(满仓) */
  label: string;
  /** 交易日数 */
  days: number;
}

/** 逐日目标仓位 → 仓位分布（按 25% 一档；100 与 0 单列） */
export function positionDistribution(exposureByDay: number[]): PositionDistBucket[] {
  const buckets = [
    { label: '100%(满仓)', days: 0 },
    { label: '76-99%', days: 0 },
    { label: '51-75%', days: 0 },
    { label: '26-50%', days: 0 },
    { label: '1-25%', days: 0 },
    { label: '0%(空仓)', days: 0 },
  ];
  for (const e of exposureByDay) {
    if (e >= 100) buckets[0].days++;
    else if (e > 75) buckets[1].days++;
    else if (e > 50) buckets[2].days++;
    else if (e > 25) buckets[3].days++;
    else if (e > 0) buckets[4].days++;
    else buckets[5].days++;
  }
  return buckets.filter((b) => b.days > 0);
}

/** 持股时间占比 %：暴露 > 0 的交易日占比（对齐果仁 open-rate 口径） */
export function holdingDaysPct(exposureByDay: number[]): number {
  if (!exposureByDay.length) return 0;
  const held = exposureByDay.filter((e) => e > 0).length;
  return +((held / exposureByDay.length) * 100).toFixed(1);
}

export interface MissedRally {
  /** 交易日 YYYYMMDD */
  date: number;
  /** 基准当日涨幅 % */
  pct: number;
  /** 当日目标仓位 % */
  exposure: number;
}

/**
 * 踏空归因：基准单日涨幅 Top N 中，目标仓位低于阈值（默认 50%）的交易日。
 * 择时的隐形成本显性化——"躲过下跌"的另一面是"错过的大涨"。
 */
export function missedRallies(
  benchReturns: number[],
  dates: number[],
  exposureByDay: number[],
  topN = 10,
  thresholdPct = 50,
): MissedRally[] {
  const rows = benchReturns
    .map((r, i) => ({ date: dates[i], pct: +(r * 100).toFixed(2), exposure: exposureByDay[i] ?? 100 }))
    .filter((row) => row.exposure < thresholdPct)
    .sort((a, b) => b.pct - a.pct);
  return rows.slice(0, topN);
}
