import { ApiException } from '../common/api.exception';
import { ClarificationSignal, LOT_SIZE } from './strategy-backtest.service';
import type { FunctionSpec } from '../types';

export type { FunctionSpec };

/* ----- 权重/仓位统一函数字典（ADR-0005） -----
 * GLM 按 {name, params} 引用字典条目；引擎每决策日以 ctx 求值。
 * 参数只放策略旋钮，一切数据类输入（因子截面、IC、名次、剩余资金）由引擎上下文供给——
 * 参数越少，模型出错越少。加函数 = 在 FUNCTIONS 加条目（发版），模型即点即用。 */

/** 权重函数入参：每决策日由引擎构造 */
export interface FactorWeightCtx {
  factors: { table: string; field: string; direction: 1 | -1; weight?: number }[];
  /** 各因子候选池截面（引擎已取，缓存→DB；与 ctx.factors 同序） */
  sections: Map<string, number>[];
  /** 各因子滚动 Rank IC 均值（ic_weight 消费，引擎按窗口预计算，键 = table.field） */
  icByFactor?: Record<string, number>;
  pool: string[];
  count: number;
}

/** 仓位函数入参：每决策日由引擎构造 */
export interface PositionCtx {
  /** 本期拟买入候选（综合分降序） */
  candidates: { code: string; rank: number; score: number }[];
  /** 定权因子截面（factor_position 的 params 因子引用，引擎预取，缓存→DB） */
  sizingSection?: Map<string, number>;
  /** 当期可投目标金额（权益 × 理想仓位% × 择时暴露） */
  remainingCash: number;
  /** 当期可投仓位 %（理想仓位% × 择时暴露） */
  remainingPct: number;
  maxPositions: number;
}

export type WeightFn = (ctx: FactorWeightCtx) => number[];
export type PositionFn = (ctx: PositionCtx) => Record<string, number>;

type FnKind = 'factor-weight' | 'position';

interface FnDef {
  kind: FnKind;
  description: string;
  paramsDescription: string;
  /** 返回 null = 合法；字符串 = 面向模型的澄清指引 */
  validateParams(raw: unknown): string | null;
  fn: (ctx: never, params: never) => unknown;
}

/* ----- 对位宽容规则（定案）：短于条目数 → 剩余条目平分剩余比例；长于 → 截断；
 *  总和 >1 → 归一到 1；总和 <1 → 差额留现金。非有限/负值丢弃。 ----- */
export function buildProportions(proportions: number[] | undefined, n: number): number[] {
  if (n <= 0) return [];
  if (!proportions || !proportions.length) return Array(n).fill(1 / n);
  const filled = proportions
    .filter((v) => Number.isFinite(v) && v >= 0)
    .slice(0, n);
  const sum = filled.reduce((a, b) => a + b, 0);
  if (sum > 1) for (let i = 0; i < filled.length; i++) filled[i] = filled[i] / sum;
  const rest = n - filled.length;
  if (rest > 0) {
    const leftover = Math.max(1 - filled.reduce((a, b) => a + b, 0), 0);
    filled.push(...Array(rest).fill(leftover / rest));
  }
  return filled;
}

/** Spearman 秩相关：成对过滤 → 秩变换（并列取平均秩）→ 秩上 Pearson。样本 <3 或零方差 → 0 */
export function spearman(xs: Array<number | undefined>, ys: Array<number | undefined>): number {
  const pairs: { x: number; y: number }[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i];
    const y = ys[i];
    if (x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x, y });
  }
  if (pairs.length < 3) return 0;
  const ranks = (values: number[]): number[] => {
    const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = Array(values.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
      const rank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[idx[k].i] = rank;
      i = j + 1;
    }
    return out;
  };
  const rx = ranks(pairs.map((p) => p.x));
  const ry = ranks(pairs.map((p) => p.y));
  const n = pairs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

/* ----- 参数校验（字符串 = 面向模型的澄清指引） ----- */

function numArray(raw: unknown, label: string): number[] | string {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return `${label} 须为数字数组`;
  const arr = raw.map((v) => Number(v));
  if (arr.some((v) => !Number.isFinite(v) || v < 0)) return `${label} 每项须为 ≥0 的数字`;
  return arr;
}

function intInRange(raw: unknown, label: string, min: number, max: number, dft: number): number | string {
  if (raw === undefined || raw === null || raw === '') return dft;
  const v = Number(raw);
  if (!Number.isInteger(v) || v < min || v > max) return `${label} 须为 ${min}~${max} 的整数`;
  return v;
}

function factorRef(raw: unknown): { table: string; field: string } | string {
  const o = (raw ?? {}) as Record<string, unknown>;
  const f = (o.factor ?? {}) as Record<string, unknown>;
  const table = String(f.table ?? '').trim();
  const field = String(f.field ?? '').trim();
  if (!table || !field) return 'factor 须为 { table, field }（定权因子引用，来自系统提示的表目录）';
  return { table, field };
}

const factorKey = (f: { table: string; field: string }): string => `${f.table}.${f.field}`;

/* ----- 字典条目 ----- */

const FUNCTIONS: Record<string, FnDef> = {
  constant_weights: {
    kind: 'factor-weight',
    description: '常数比例：按因子登记顺序给固定权重（缺省等权 1/N）',
    paramsDescription: '{ weights?: number[] } 各因子权重，按顺序对位；省略 = 等权',
    validateParams(raw) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const r = numArray(o.weights, 'weights');
      return typeof r === 'string' ? r : null;
    },
    fn: (ctx: FactorWeightCtx, params: unknown) => {
      const o = (params ?? {}) as { weights?: number[] };
      return buildProportions(o.weights, ctx.factors.length);
    },
  },
  ic_weight: {
    kind: 'factor-weight',
    description: 'IC 加权：各因子按滚动 Rank IC 均值正部归一化定权（负 IC 记 0）',
    paramsDescription: '{ icWindow?: number } 滚动窗口交易日数（默认 20，5~250）',
    validateParams(raw) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const r = intInRange(o.icWindow, 'icWindow', 5, 250, 20);
      return typeof r === 'string' ? r : null;
    },
    fn: (ctx: FactorWeightCtx) => {
      // icWindow 由引擎消费（预计算 ctx.icByFactor），函数只做归一化
      const ic = ctx.icByFactor ?? {};
      const pos = ctx.factors.map((f) => Math.max(ic[factorKey(f)] ?? 0, 0));
      const sum = pos.reduce((a, b) => a + b, 0);
      return sum > 0 ? pos.map((v) => v / sum) : Array(ctx.factors.length).fill(1 / Math.max(ctx.factors.length, 1));
    },
  },
  constant_proportions: {
    kind: 'position',
    description: '常数比例：按名次对位分配可投资金（缺省等权）',
    paramsDescription: '{ proportions?: number[] } 各名次的资金比例；省略 = 等权；总和 >1 自动归一，<1 差额留现金',
    validateParams(raw) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const r = numArray(o.proportions, 'proportions');
      return typeof r === 'string' ? r : null;
    },
    fn: (ctx: PositionCtx, params: unknown) => {
      const o = (params ?? {}) as { proportions?: number[] };
      const shares = buildProportions(o.proportions, ctx.candidates.length);
      const out: Record<string, number> = {};
      ctx.candidates.forEach((c, i) => {
        out[c.code] = shares[i] * ctx.remainingCash;
      });
      return out;
    },
  },
  factor_position: {
    kind: 'position',
    description: '因子仓位：按定权因子截面值正部比例加权（值越大仓位越大，全部 ≤0 该期空仓）',
    paramsDescription: '{ factor: { table, field } } 定权因子引用（如 equ_factor_obos.BIAS20 表达"站上 MA20"）',
    validateParams(raw) {
      return typeof factorRef(raw) === 'string' ? (factorRef(raw) as string) : null;
    },
    fn: (ctx: PositionCtx, params: unknown) => {
      const ref = factorRef(params);
      if (typeof ref === 'string') return {};
      const section = ctx.sizingSection;
      const weights = ctx.candidates.map((c) => Math.max(section?.get(c.code) ?? 0, 0));
      const sum = weights.reduce((a, b) => a + b, 0);
      const out: Record<string, number> = {};
      if (sum <= 0) return out; // 该期空仓（回执告警由引擎记录）
      ctx.candidates.forEach((c, i) => {
        out[c.code] = (weights[i] / sum) * ctx.remainingCash;
      });
      return out;
    },
  },
};

/* ----- 独立校验器（定案：逐条修正不硬拦，违规清单进回执） ----- */

export interface PositionAmountIssues {
  fixed: Record<string, number>;
  violations: string[];
}

/** 仓位金额前置校验：整手（向下取整到 100 股）→ 现金充足（按字典顺序，超出部分缩减/剔除）。
 *  prices 缺失的代码只做现金检查（无法判整手）。 */
export function validatePositionAmounts(
  amounts: Record<string, number>,
  opts: { cash: number; priceOf: (code: string) => number | undefined },
): PositionAmountIssues {
  const fixed: Record<string, number> = {};
  const violations: string[] = [];
  let used = 0;
  for (const [code, raw] of Object.entries(amounts)) {
    let amt = Number.isFinite(raw) && raw > 0 ? raw : 0;
    if (amt <= 0) continue; // 显式 0 仓位 = 不买，不算违规
    const price = opts.priceOf(code);
    if (price !== undefined && price > 0) {
      const shares = Math.floor(amt / price / LOT_SIZE) * LOT_SIZE;
      if (shares < LOT_SIZE) {
        violations.push(`${code} 金额不足一手（${Math.round(amt)} 元），已剔除`);
        continue;
      }
      amt = shares * price;
    }
    if (used + amt > opts.cash) {
      const room = opts.cash - used;
      if (price !== undefined && price > 0) {
        const shares = Math.floor(room / price / LOT_SIZE) * LOT_SIZE;
        if (shares >= LOT_SIZE) {
          fixed[code] = shares * price;
          used += shares * price;
          violations.push(`${code} 现金不足，缩减至 ${Math.round(shares * price)} 元`);
        } else {
          violations.push(`${code} 现金不足，已剔除`);
        }
      } else {
        violations.push(`${code} 现金不足，已剔除`);
      }
      continue;
    }
    fixed[code] = amt;
    used += amt;
  }
  return { fixed, violations };
}

/* ----- 形状断言（assertStrategyInput 用） ----- */

export function assertFunctionSpec(raw: unknown, label: string): FunctionSpec | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const o = (raw ?? {}) as Record<string, unknown>;
  if (typeof o.name !== 'string' || !o.name.trim()) {
    throw new ApiException('INVALID_ARGUMENT', 400, `${label} 须为 { name, params }：函数名 + 旋钮参数`);
  }
  return { name: o.name.trim(), params: (o.params ?? {}) as Record<string, unknown> };
}

/* ----- 解析与描述 ----- */

function kindLabel(kind: FnKind): string {
  return kind === 'factor-weight' ? '权重函数' : '仓位函数';
}

export function describeFunctions(kind?: FnKind): string {
  return Object.entries(FUNCTIONS)
    .filter(([, d]) => !kind || d.kind === kind)
    .map(([name, d]) => `- ${name}（${d.description}）；参数：${d.paramsDescription}`)
    .join('\n');
}

/** 确认门/回执展示：函数中文名 + 参数原文 */
export function formatFnCall(kind: FnKind, spec?: FunctionSpec): string {
  if (!spec) return '';
  const def = FUNCTIONS[spec.name];
  if (!def || def.kind !== kind) return JSON.stringify(spec);
  const params = spec.params && Object.keys(spec.params).length ? ` ${JSON.stringify(spec.params)}` : '（缺省）';
  return `${def.description}${params}`;
}

function resolveFromDict(
  kind: FnKind,
  spec: FunctionSpec | undefined,
): { def: FnDef; name: string; params: unknown } {
  // 缺省引用 = 绑定该 kind 的 constant 缺省形态（等权），现状行为的函数化内化
  if (!spec || (typeof spec.name !== 'string' || !spec.name.trim())) {
    if (!spec) {
      const dft = kind === 'factor-weight' ? FUNCTIONS.constant_weights : FUNCTIONS.constant_proportions;
      return { def: dft, name: kind === 'factor-weight' ? 'constant_weights' : 'constant_proportions', params: {} };
    }
    throw new ClarificationSignal({
      需要澄清: `请指定${kindLabel(kind)}：从下列函数中按 { name, params } 选择`,
      可用函数: describeFunctions(kind),
    });
  }
  const def = FUNCTIONS[spec.name];
  if (!def || def.kind !== kind) {
    throw new ApiException(
      'INVALID_ARGUMENT',
      400,
      `未知${kindLabel(kind)} "${spec.name}"。可用名录：\n${describeFunctions(kind)}`,
    );
  }
  const error = def.validateParams(spec.params);
  if (error) {
    throw new ClarificationSignal({
      需要澄清: `${spec.name} 参数不合法：${error}`,
      参数说明: def.paramsDescription,
    });
  }
  return { def, name: spec.name, params: spec.params ?? {} };
}

/** 解析权重函数引用 → 已绑定参数的纯函数；缺省 = constant_weights 等权。
 *  icWindow 非 undefined 时，引擎须在 ctx.icByFactor 预计算滚动 IC。 */
export function resolveWeightFn(spec?: FunctionSpec): { fn: WeightFn; icWindow?: number } {
  const { def, params } = resolveFromDict('factor-weight', spec);
  const fn = def.fn as (ctx: FactorWeightCtx, params: unknown) => number[];
  if (def === FUNCTIONS.ic_weight) {
    const icWindow = intInRange((params as { icWindow?: unknown }).icWindow, 'icWindow', 5, 250, 20) as number;
    return { fn: (ctx) => fn(ctx, params), icWindow };
  }
  return { fn: (ctx) => fn(ctx, params) };
}

/** 解析仓位函数引用 → 已绑定参数的纯函数；缺省 = constant_proportions 等权。
 *  factorRef 非 undefined 时，引擎须预取该因子截面进 ctx.sizingSection（须过字典白名单）。 */
export function resolvePositionFn(spec?: FunctionSpec): {
  fn: PositionFn;
  factorRef?: { table: string; field: string };
} {
  const { def, params } = resolveFromDict('position', spec);
  const fn = def.fn as (ctx: PositionCtx, params: unknown) => Record<string, number>;
  if (def === FUNCTIONS.factor_position) {
    const factorRef = factorRefOf(params);
    return { fn: (ctx) => fn(ctx, params), factorRef };
  }
  return { fn: (ctx) => fn(ctx, params) };
}

function factorRefOf(params: unknown): { table: string; field: string } {
  const r = factorRef(params);
  return typeof r === 'string' ? { table: '', field: '' } : r;
}
