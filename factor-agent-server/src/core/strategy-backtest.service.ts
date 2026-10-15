import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { AgentProgressSink, BacktestCard, RawMetrics } from '../types';
import { TradeDateCoverage } from './factor-data.service';
import { maxDrawdownPct, toMetricItems } from './backtest.service';
import { assertTimingOverlay, collectTimingRefs, StrategyTimingOverlay } from './timing';

/* ==========================================================
   策略回测接口（契约层）—— 日频事件驱动内核（重构方案 v3，StrategySpec v1）
   实现：implementations/strategy-backtest.service.impl.ts

   与旧"净值制截面引擎"的关系：全面重构替代（旧 equal-weight-backtest 已删除）。
   旧的等权多因子调用 = 新参数的特例：entryFilters/sellRules 传空、旧因子列表进
   sortFactors、frequency 折算为 rebalanceIntervalDays（见 legacyConfigToInput）。

   内核口径（v1）：
   - 信号与执行分离：T 日收盘算信号（过滤→排序→目标持仓/卖出规则），T+1 执行；
   - 资金账户：初始资金（默认 100 万）、整手（买入 100 股向下取整）、
     单边费率双边计提（默认万三）、卖出资金当日可用于买入、空闲资金留存现金；
   - A 股规则：T+1（当日买入不可卖）、停牌顺延（无行情不交易、持仓顺延估值）、
     涨跌停一期简化（执行价触及 ±10% 视为不可成交，顺延/放弃）；
   - 因子即取数规格：无 FactorDef，全部按 entryFilters/sortFactors/sellRules 引用的
     table.field 从白名单数据表读截面，引擎不在线计算任何因子；
   - 过滤/排序分参：同一因子既过滤又排序时两处重复传入，引擎不合并；
   - 排序：截面分位数标准化（0~100）→ 加权合成（weight 缺省等权 1/N）→
     综合分降序取前 maxPositions；sortFactors 为空时兜底追加 20 日动量（值大优）；
   - 职责边界：引擎只执行单次给定参数的回测，参数自动寻优是 GLM 编排层职责。
   ========================================================== */

/* ----- 基准 ----- */

export type BenchmarkKey = 'hs300' | 'csi500' | 'sse';

/** 基准 → 指数代码与中文名（mkt_idxd.TICKER_SYMBOL） */
export const BENCHMARKS: Record<BenchmarkKey, { ticker: string; name: string }> = {
  hs300: { ticker: '000300', name: '沪深300' },
  csi500: { ticker: '000905', name: '中证500' },
  sse: { ticker: '000001', name: '上证指数' },
};

/* ----- 因子参数（过滤 / 排序 / 卖出，全部是 table.field 取数规格 + 数字） ----- */

/** 过滤规则：当日截面值不满足条件即剔除（缺失值视为不满足） */
export interface StrategyFilterRule {
  table: string;
  field: string;
  op: '>' | '<';
  value: number;
}

/** 排序因子：direction 1=值大优（降序）/ -1=值小优（升序）。
 *  weight 全省略 = 等权 1/N；加权模式下全部因子必须都传（引擎按总和归一化） */
export interface StrategySortFactor {
  table: string;
  field: string;
  direction: 1 | -1;
  weight?: number;
}

/** 卖出规则：持仓期每日收盘后检查，命中生成 T+1 卖出指令（全仓） */
export type StrategySellRule =
  | { kind: 'field'; table: string; field: string; op: '>' | '<'; value: number }
  | { kind: 'stop_profit'; pct: number }
  | { kind: 'stop_loss'; pct: number }
  | { kind: 'max_drawdown_from_entry'; pct: number }
  | { kind: 'max_hold_days'; days: number }
  | { kind: 'rank_out'; bottomN: number };

/* ----- 工具入参（LLM 传入，字段均为未知形态，服务端归一化校验） ----- */

export interface StrategyBacktestInput {
  /** 股票池：证券代码清单（000002.XSHE 形态）。缺省/空 = 全市场。
   *  大清单应由前置筛选产出；GLM 不要在对话里手拼超长清单 */
  securityIds?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  /** 初始资金，默认 1000000 */
  initialCapital?: unknown;
  /** 单边费率（小数），默认 0.0003（万三），买卖双边计提 */
  feeRate?: unknown;
  /** 每 N 个交易日调仓（必填，无默认值，缺失触发向用户澄清） */
  rebalanceIntervalDays?: unknown;
  /** 触发模式（rebalanceIntervalDays=0）必填：仓位偏离带宽 %（5~50 整数） */
  positionDeviatePct?: unknown;
  /** 0=开盘价成交（默认）/ 1=收盘价成交 */
  executionTiming?: unknown;
  /** 最大持仓数，默认 10 */
  maxPositions?: unknown;
  /** 每只理想仓位 %，缺省 = 100/maxPositions（满仓等权） */
  idealPositionPct?: unknown;
  /** 最小建仓仓位 %（低于则放弃该候选），默认 1 */
  minPositionPct?: unknown;
  /** 过滤因子（全部满足才入选） */
  entryFilters?: unknown;
  /** 排序因子（缺省 = 默认 20 日动量·值大优，弹窗如实展示） */
  sortFactors?: unknown;
  /** 卖出规则（持仓期每日检查） */
  sellRules?: unknown;
  benchmark?: unknown;
  /** 大盘择时叠加（可选）：字段条件投票状态机 + 分级熊市仓位，见 timing.ts */
  timingOverlay?: unknown;
  /** 策略类型标记（透传卡片/策略库；缺省 equal_weight = 等权特例形态） */
  strategyType?: unknown;
}

/** 归一化后的合法入参 */
export interface NormalizedStrategyInput {
  /** null = 全市场 */
  securityIds: string[] | null;
  startDate: string;
  endDate: string;
  initialCapital: number;
  feeRate: number;
  rebalanceIntervalDays: number;
  /** 触发模式（=0）的仓位偏离带宽 %；日历模式无此字段 */
  positionDeviatePct?: number;
  executionTiming: 0 | 1;
  maxPositions: number;
  idealPositionPct: number;
  minPositionPct: number;
  entryFilters: StrategyFilterRule[];
  sortFactors: StrategySortFactor[];
  sellRules: StrategySellRule[];
  benchmark: BenchmarkKey;
  /** 大盘择时叠加（未传 = 不择时，全程满仓） */
  timingOverlay?: StrategyTimingOverlay;
  strategyType: string;
}

/* ----- 常量 ----- */

export const INITIAL_CAPITAL_DEFAULT = 1_000_000;
export const FEE_RATE_DEFAULT = 0.0003;
export const REBALANCE_INTERVAL_MIN = 1;
export const REBALANCE_INTERVAL_MAX = 250;
/** 调仓次数上限（约两年日频）：逐调仓日全截面取数为 期数×字段数 次查询，超限耗时不可控 */
export const MAX_REBALANCES = 550;
export const MAX_POSITIONS_DEFAULT = 10;
export const MAX_POSITIONS_MAX = 100;
export const MIN_POSITION_PCT_DEFAULT = 1;
export const MAX_RULES = 10;
/** 股票池清单长度上限 */
export const SECURITY_IDS_MAX = 5000;
/** 候选并集（预取行情/卖出因子的股票全集）上限：超过说明频率×持仓×区间组合的数据量不可控 */
export const MAX_CANDIDATE_UNIVERSE = 1500;
/** 每手股数（A 股整手） */
export const LOT_SIZE = 100;
/** 涨跌停判定容差：执行价相对昨收涨过 9.99% 视为涨停（买不进）、跌过 9.99% 视为跌停（卖不出）。
 *  一期简化：统一按 ±10% 主板口径，ST/创业板/科创板的差异档不做区分 */
export const LIMIT_UP_RATIO = 1.0999;
export const LIMIT_DOWN_RATIO = 0.9001;

/** 默认排序因子（sortFactors 为空时兜底追加）：20 日价格动量（equ_factor_obos.REVS20，
 *  字典口径"过去 20 个交易日区间收益率"），方向定死值大优（涨得多优先），不提供反转配置 */
export const DEFAULT_MOMENTUM_FACTOR: StrategySortFactor = {
  table: 'equ_factor_obos',
  field: 'REVS20',
  direction: 1,
};

/** 有效排序因子：空清单 → 追加默认动量因子。GLM 组装参数时就应显式写入默认因子
 *  （确认弹窗自然可见），这里是引擎侧的双保险兜底 */
export function effectiveSortFactors(sortFactors: StrategySortFactor[]): {
  factors: StrategySortFactor[];
  usedDefault: boolean;
} {
  return sortFactors.length
    ? { factors: sortFactors, usedDefault: false }
    : { factors: [DEFAULT_MOMENTUM_FACTOR], usedDefault: true };
}

/** 排序因子 → 展示串（含方向与权重，确认弹窗/卡片/摘要共用同一口径） */
export function describeSortFactors(factors: StrategySortFactor[], sep = '；'): string {
  return factors
    .map((f) =>
      `${f.table}.${f.field}（${f.direction === 1 ? '值大优' : '值小优'}，${f.weight !== undefined ? `权重 ${f.weight}` : '等权'}）`,
    )
    .join(sep);
}

/** 过滤规则 → 展示串 */
export function describeFilters(filters: StrategyFilterRule[], sep = '；'): string {
  return filters.length ? filters.map((f) => `${f.table}.${f.field} ${f.op} ${f.value}`).join(sep) : '无';
}

/** 卖出规则 → 展示串 */
export function describeSellRules(rules: StrategySellRule[]): string {
  return rules.length
    ? rules
        .map((r) => {
          switch (r.kind) {
            case 'field':
              return `${r.table}.${r.field} ${r.op} ${r.value}`;
            case 'stop_profit':
              return `止盈+${r.pct}%`;
            case 'stop_loss':
              return `止损-${r.pct}%`;
            case 'max_drawdown_from_entry':
              return `回撤止盈${r.pct}%`;
            case 'max_hold_days':
              return `持有满${r.days}日`;
            case 'rank_out':
              return `跌出前${r.bottomN}名`;
          }
        })
        .join('；')
    : '无';
}

/* ----- 澄清信号 ----- */

/** 工具澄清信号：不是入参错误，而是"需要模型向用户追问"的场景。
 *  guide 即返回给模型的工具回执（非 error 形态），由 agent 层统一兜底原样转发，
 *  引导模型向用户提问而不是把报错转述给用户。 */
export class ClarificationSignal extends Error {
  constructor(/** 返回给模型的澄清指引 */ readonly guide: Record<string, unknown>) {
    super('需要用户澄清后再执行');
    this.name = 'ClarificationSignal';
  }
}

/* ----- 入参归一化与校验（纯函数；字典白名单由实现层补一道） ----- */

/** 归一化 + 格式校验；非法入参抛 INVALID_ARGUMENT。rebalanceIntervalDays 缺失必报澄清信号（无默认值）。 */
export function assertStrategyInput(raw: StrategyBacktestInput): NormalizedStrategyInput {
  const startDate = String(raw.startDate ?? '').trim();
  const endDate = String(raw.endDate ?? '').trim();

  if (!startDate || !endDate) {
    throw new ApiException(
      'INVALID_ARGUMENT',
      400,
      '参数不完整：需要 startDate/endDate（纯数字 YYYYMMDD）。用户说过的区间照传，只给了相对时间' +
        '（如"最近两年"）按系统提示的今天日期换算，完全没提时填合理区间即可——参数执行前会经用户确认，可被当场修改',
    );
  }
  if (!/^\d{8}$/.test(startDate) || !/^\d{8}$/.test(endDate) || Number(startDate) >= Number(endDate)) {
    throw new ApiException('INVALID_ARGUMENT', 400, `回测区间非法：startDate/endDate 须为纯数字 YYYYMMDD 且 start 早于 end，当前 ${startDate} ~ ${endDate}`);
  }

  // 股票池：缺省/空数组 = 全市场；给了必须全是 000002.XSHE 形态
  let securityIds: string[] | null = null;
  if (raw.securityIds !== undefined && raw.securityIds !== null && raw.securityIds !== '') {
    if (!Array.isArray(raw.securityIds)) {
      throw new ApiException('INVALID_ARGUMENT', 400, 'securityIds 必须是证券代码数组（如 ["000002.XSHE"]），缺省表示全市场');
    }
    const list = (raw.securityIds as unknown[]).map((c) => String(c ?? '').trim()).filter(Boolean);
    for (const code of list) {
      if (!/^\d{6}\.[A-Za-z]{2,8}$/.test(code)) {
        throw new ApiException('INVALID_ARGUMENT', 400, `securityIds 中的证券代码格式须为 000002.XSHE: ${code}`);
      }
    }
    if (list.length > SECURITY_IDS_MAX) {
      throw new ApiException('INVALID_ARGUMENT', 400, `securityIds 过多（${list.length} 个，上限 ${SECURITY_IDS_MAX}）`);
    }
    securityIds = list.length ? [...new Set(list)] : null; // 空数组 = 全市场
  }

  const initialCapital = raw.initialCapital === undefined || raw.initialCapital === null || raw.initialCapital === ''
    ? INITIAL_CAPITAL_DEFAULT
    : Number(raw.initialCapital);
  if (!Number.isFinite(initialCapital) || initialCapital <= 0 || initialCapital > 1e10) {
    throw new ApiException('INVALID_ARGUMENT', 400, `initialCapital 须为 0~100 亿的正数: ${raw.initialCapital}`);
  }

  const feeRate = raw.feeRate === undefined || raw.feeRate === null || raw.feeRate === ''
    ? FEE_RATE_DEFAULT
    : Number(raw.feeRate);
  if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 0.05) {
    throw new ApiException('INVALID_ARGUMENT', 400, `feeRate 须为 0~0.05 的小数（单边费率，如 0.0003 = 万三）: ${raw.feeRate}`);
  }

  // 调仓间隔：必填，无默认值；缺失抛澄清信号（由模型向用户追问），非法数值才是入参错误
  if (raw.rebalanceIntervalDays === undefined || raw.rebalanceIntervalDays === null || String(raw.rebalanceIntervalDays).trim() === '') {
    throw new ClarificationSignal({
      需要澄清: '调仓间隔 rebalanceIntervalDays（必填，无默认值）',
      含义: '每隔多少个交易日调仓一次（如 5≈每周、10≈每两周、21≈每月、63≈每季）',
      行动: '不要把本回执当错误转述给用户；请直接向用户询问期望的调仓间隔，等用户答复后再调用本工具。' +
        '再次调用时必须把用户此前已明确的参数一并传入（区间、持仓只数 maxPositions、费用 feeRate、' +
        '过滤/排序/卖出规则等），只追问缺失的参数，禁止把用户说过的数值偷偷换成默认值',
    });
  }
  const rebalanceIntervalDays = Number(raw.rebalanceIntervalDays);
  if (
    !Number.isInteger(rebalanceIntervalDays) ||
    (rebalanceIntervalDays !== 0 && (rebalanceIntervalDays < REBALANCE_INTERVAL_MIN || rebalanceIntervalDays > REBALANCE_INTERVAL_MAX))
  ) {
    throw new ApiException(
      'INVALID_ARGUMENT',
      400,
      `rebalanceIntervalDays 必须是 0（触发模式，条件触发调仓）或 ${REBALANCE_INTERVAL_MIN}~${REBALANCE_INTERVAL_MAX} 的整数（每隔多少个交易日调仓一次）: ${raw.rebalanceIntervalDays}`,
    );
  }

  // 触发模式（rebalanceIntervalDays=0，模型 Ⅱ 独立引擎）：必须带仓位偏离带
  let positionDeviatePct: number | undefined;
  if (rebalanceIntervalDays === 0) {
    if (raw.positionDeviatePct === undefined || raw.positionDeviatePct === null || raw.positionDeviatePct === '') {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        '触发模式（rebalanceIntervalDays=0）必须传 positionDeviatePct：仓位偏离带宽 %（如 20 表示持仓市值偏离目标总仓位 ±20% 时触发再平衡）',
      );
    }
    positionDeviatePct = Number(raw.positionDeviatePct);
    if (!Number.isInteger(positionDeviatePct) || positionDeviatePct < 5 || positionDeviatePct > 50) {
      throw new ApiException('INVALID_ARGUMENT', 400, `positionDeviatePct 须为 5~50 的整数（偏离带宽 %）: ${raw.positionDeviatePct}`);
    }
  }

  const executionTiming = raw.executionTiming === undefined || raw.executionTiming === null || raw.executionTiming === ''
    ? 0
    : Number(raw.executionTiming);
  if (executionTiming !== 0 && executionTiming !== 1) {
    throw new ApiException('INVALID_ARGUMENT', 400, `executionTiming 只允许 0（开盘价成交）或 1（收盘价成交）: ${raw.executionTiming}`);
  }

  const maxPositions = raw.maxPositions === undefined || raw.maxPositions === null || raw.maxPositions === ''
    ? MAX_POSITIONS_DEFAULT
    : Number(raw.maxPositions);
  if (!Number.isInteger(maxPositions) || maxPositions < 1 || maxPositions > MAX_POSITIONS_MAX) {
    throw new ApiException('INVALID_ARGUMENT', 400, `maxPositions 必须是 1~${MAX_POSITIONS_MAX} 的整数: ${raw.maxPositions}`);
  }

  const idealPositionPct = raw.idealPositionPct === undefined || raw.idealPositionPct === null || raw.idealPositionPct === ''
    ? +(100 / maxPositions).toFixed(2)
    : Number(raw.idealPositionPct);
  if (!Number.isFinite(idealPositionPct) || idealPositionPct <= 0 || idealPositionPct > 100) {
    throw new ApiException('INVALID_ARGUMENT', 400, `idealPositionPct 须为 0~100 的百分比数值（每只目标仓位 %）: ${raw.idealPositionPct}`);
  }

  const minPositionPct = raw.minPositionPct === undefined || raw.minPositionPct === null || raw.minPositionPct === ''
    ? MIN_POSITION_PCT_DEFAULT
    : Number(raw.minPositionPct);
  if (!Number.isFinite(minPositionPct) || minPositionPct < 0.1 || minPositionPct > idealPositionPct) {
    throw new ApiException('INVALID_ARGUMENT', 400, `minPositionPct 须为 0.1~${idealPositionPct} 的百分比数值（不能大于每只理想仓位）: ${raw.minPositionPct}`);
  }

  return {
    securityIds,
    startDate,
    endDate,
    initialCapital,
    feeRate,
    rebalanceIntervalDays,
    ...(positionDeviatePct !== undefined ? { positionDeviatePct } : {}),
    executionTiming: executionTiming as 0 | 1,
    maxPositions,
    idealPositionPct,
    minPositionPct,
    entryFilters: assertFilters(raw.entryFilters),
    sortFactors: assertSortFactors(raw.sortFactors),
    sellRules: assertSellRules(raw.sellRules),
    benchmark: assertBenchmark(raw.benchmark),
    timingOverlay: assertTimingOverlay(raw.timingOverlay),
    strategyType: raw.strategyType === undefined || raw.strategyType === null || raw.strategyType === ''
      ? 'equal_weight'
      : String(raw.strategyType).trim(),
  };
}

function assertFilters(rawFilters: unknown): StrategyFilterRule[] {
  if (rawFilters === undefined || rawFilters === null || rawFilters === '') return [];
  if (!Array.isArray(rawFilters)) {
    throw new ApiException('INVALID_ARGUMENT', 400, 'entryFilters 必须是数组，每项 {table, field, op, value}');
  }
  if (rawFilters.length > MAX_RULES) {
    throw new ApiException('INVALID_ARGUMENT', 400, `entryFilters 过多（${rawFilters.length} 条，最多 ${MAX_RULES} 条）`);
  }
  return rawFilters.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const table = String(o.table ?? '').trim();
    const field = String(o.field ?? '').trim();
    const op = String(o.op ?? '').trim();
    const value = Number(o.value);
    if (!table || !field) {
      throw new ApiException('INVALID_ARGUMENT', 400, `entryFilters 每项都需要 table 与 field: ${JSON.stringify(item)}`);
    }
    if (op !== '>' && op !== '<') {
      throw new ApiException('INVALID_ARGUMENT', 400, `entryFilters[].op 只允许 '>' 或 '<': ${op}`);
    }
    if (!Number.isFinite(value)) {
      throw new ApiException('INVALID_ARGUMENT', 400, `entryFilters[].value 须为有限数字: ${JSON.stringify(item)}`);
    }
    return { table, field, op, value };
  });
}

function assertSortFactors(rawFactors: unknown): StrategySortFactor[] {
  if (rawFactors === undefined || rawFactors === null || rawFactors === '') return [];
  if (!Array.isArray(rawFactors)) {
    throw new ApiException('INVALID_ARGUMENT', 400, 'sortFactors 必须是数组，每项 {table, field, direction, weight?}');
  }
  if (rawFactors.length > MAX_RULES) {
    throw new ApiException('INVALID_ARGUMENT', 400, `sortFactors 过多（${rawFactors.length} 个，最多 ${MAX_RULES} 个）`);
  }
  const factors: StrategySortFactor[] = [];
  const seen = new Set<string>();
  let weightCount = 0;
  for (const item of rawFactors) {
    const o = (item ?? {}) as Record<string, unknown>;
    const table = String(o.table ?? '').trim();
    const field = String(o.field ?? '').trim();
    const direction = Number(o.direction);
    if (!table || !field) {
      throw new ApiException('INVALID_ARGUMENT', 400, `sortFactors 每项都需要 table 与 field: ${JSON.stringify(item)}`);
    }
    if (direction !== 1 && direction !== -1) {
      throw new ApiException('INVALID_ARGUMENT', 400, `sortFactors[].direction 只允许 1（值大优）或 -1（值小优）: ${String(o.direction)}`);
    }
    const key = `${table}.${field}`;
    if (seen.has(key)) continue; // 重复因子忽略（同一因子过滤+排序两处传是合法的，列表内重复无意义）
    seen.add(key);
    let weight: number | undefined;
    if (o.weight !== undefined && o.weight !== null && o.weight !== '') {
      weight = Number(o.weight);
      if (!Number.isFinite(weight) || weight <= 0) {
        throw new ApiException('INVALID_ARGUMENT', 400, `sortFactors[].weight 须为正数（引擎按总和归一化）: ${String(o.weight)}`);
      }
      weightCount++;
    }
    factors.push({ table, field, direction: direction as 1 | -1, ...(weight !== undefined ? { weight } : {}) });
  }
  if (weightCount > 0 && weightCount < factors.length) {
    throw new ApiException(
      'INVALID_ARGUMENT',
      400,
      `sortFactors 的 weight 只支持两种模式：全省略（等权 1/N）或全部传入（加权合成），当前 ${factors.length} 个因子只传了 ${weightCount} 个`,
    );
  }
  return factors;
}

function assertSellRules(rawRules: unknown): StrategySellRule[] {
  if (rawRules === undefined || rawRules === null || rawRules === '') return [];
  if (!Array.isArray(rawRules)) {
    throw new ApiException(
      'INVALID_ARGUMENT',
      400,
      'sellRules 必须是数组，支持 kind: field（字段条件）/ stop_profit / stop_loss / max_drawdown_from_entry / max_hold_days / rank_out',
    );
  }
  if (rawRules.length > MAX_RULES) {
    throw new ApiException('INVALID_ARGUMENT', 400, `sellRules 过多（${rawRules.length} 条，最多 ${MAX_RULES} 条）`);
  }
  return rawRules.map((item) => {
    const o = (item ?? {}) as Record<string, unknown>;
    const kind = String(o.kind ?? '').trim();
    switch (kind) {
      case 'field': {
        const table = String(o.table ?? '').trim();
        const field = String(o.field ?? '').trim();
        const op = String(o.op ?? '').trim();
        const value = Number(o.value);
        if (!table || !field) {
          throw new ApiException('INVALID_ARGUMENT', 400, `sellRules field 条件需要 table 与 field: ${JSON.stringify(item)}`);
        }
        if (op !== '>' && op !== '<') {
          throw new ApiException('INVALID_ARGUMENT', 400, `sellRules field 条件的 op 只允许 '>' 或 '<': ${op}`);
        }
        if (!Number.isFinite(value)) {
          throw new ApiException('INVALID_ARGUMENT', 400, `sellRules field 条件的 value 须为有限数字: ${JSON.stringify(item)}`);
        }
        return { kind: 'field' as const, table, field, op, value };
      }
      case 'stop_profit':
      case 'stop_loss':
      case 'max_drawdown_from_entry': {
        const pct = Number(o.pct);
        if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) {
          throw new ApiException('INVALID_ARGUMENT', 400, `sellRules ${kind} 的 pct 须为 0~1000 的百分比数值: ${String(o.pct)}`);
        }
        return (kind === 'stop_profit' ? { kind: 'stop_profit' as const, pct } : kind === 'stop_loss' ? { kind: 'stop_loss' as const, pct } : { kind: 'max_drawdown_from_entry' as const, pct });
      }
      case 'max_hold_days': {
        const days = Number(o.days);
        if (!Number.isInteger(days) || days < 1 || days > 2500) {
          throw new ApiException('INVALID_ARGUMENT', 400, `sellRules max_hold_days 的 days 须为 1~2500 的整数（交易日）: ${String(o.days)}`);
        }
        return { kind: 'max_hold_days' as const, days };
      }
      case 'rank_out': {
        const bottomN = Number(o.bottomN);
        if (!Number.isInteger(bottomN) || bottomN < 1 || bottomN > MAX_POSITIONS_MAX) {
          throw new ApiException('INVALID_ARGUMENT', 400, `sellRules rank_out 的 bottomN 须为 1~${MAX_POSITIONS_MAX} 的整数: ${String(o.bottomN)}`);
        }
        return { kind: 'rank_out' as const, bottomN };
      }
      default:
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `sellRules[].kind 非法: ${kind}。可选 field / stop_profit / stop_loss / max_drawdown_from_entry / max_hold_days / rank_out`,
        );
    }
  });
}

function assertBenchmark(raw: unknown): BenchmarkKey {
  const benchmark = (raw === undefined || raw === null || raw === '' ? 'hs300' : String(raw)) as BenchmarkKey;
  if (!(benchmark in BENCHMARKS)) {
    throw new ApiException('INVALID_ARGUMENT', 400, `benchmark 只允许 hs300（沪深300）/ csi500（中证500）/ sse（上证指数）: ${raw}`);
  }
  return benchmark;
}

/* ----- 因子引用集合（白名单快检与预取共用） ----- */

export interface FactorRef {
  table: string;
  field: string;
}

/** 归一化入参引用的全部 (table, field)：entryFilters + 有效排序因子 + field 类卖出规则，去重保序。
 *  注意：不含择时引用——择时字段按挂靠指数走 readIndexFieldSeries 通道（键形态不同，
 *  混进截面预取会对无 SECURITY_ID 列的指数表报错）；白名单/日历用 collectTimingRefs 单独取 */
export function collectFactorRefs(p: NormalizedStrategyInput): FactorRef[] {
  const refs: FactorRef[] = [];
  const seen = new Set<string>();
  const push = (table: string, field: string) => {
    const key = `${table}.${field}`;
    if (!seen.has(key)) {
      seen.add(key);
      refs.push({ table, field });
    }
  };
  for (const f of p.entryFilters) push(f.table, f.field);
  for (const f of effectiveSortFactors(p.sortFactors).factors) push(f.table, f.field);
  for (const r of p.sellRules) if (r.kind === 'field') push(r.table, r.field);
  return refs;
}

/** 全部引用 = 因子引用 + 择时引用（白名单校验/日历推导用；截面预取只能用 collectFactorRefs） */
export function collectAllRefs(p: NormalizedStrategyInput): FactorRef[] {
  const refs = collectFactorRefs(p);
  const seen = new Set(refs.map((r) => `${r.table}.${r.field}`));
  if (p.timingOverlay) {
    for (const r of collectTimingRefs(p.timingOverlay)) {
      if (!seen.has(`${r.table}.${r.field}`)) refs.push(r);
    }
  }
  return refs;
}

/* ----- 调仓信号纯函数：过滤 → 分位数合成排序 ----- */

/**
 * 过滤：pool 内逐股检查全部过滤规则的当日截面值，全部满足才存活；任一缺失视为不满足。
 * @param filters   过滤规则列表
 * @param sections  与 filters 一一对应的当日截面（code → 值）
 */
export function applyEntryFilters(
  pool: string[],
  filters: StrategyFilterRule[],
  sections: Map<string, number>[],
): string[] {
  return pool.filter((code) =>
    filters.every((rule, i) => {
      const v = sections[i]?.get(code);
      return v !== undefined && (rule.op === '>' ? v > rule.value : v < rule.value);
    }),
  );
}

/**
 * 排序合成：各排序因子在存活池上按值升序算分位数（(排名)/n），direction=1 直接用
 * （值大 → 分位高）、-1 取 1-分位数；标准化到 0~100 后加权平均（weight 缺省等权 1/N，
 * 只对该股有值的因子重归一化），全部因子都缺值的股票不入选。
 * @returns 综合分降序的候选列表
 */
export function rankUniverse(
  factors: StrategySortFactor[],
  sections: Map<string, number>[],
  pool: string[],
): { code: string; score: number }[] {
  const weightTotal = factors.reduce((a, f) => a + (f.weight ?? 0), 0);
  const scoreSum = new Map<string, number>();
  factors.forEach((factor, i) => {
    const rows = pool
      .map((code) => ({ code, value: sections[i]?.get(code) }))
      .filter((r): r is { code: string; value: number } => r.value !== undefined);
    if (!rows.length) return;
    rows.sort((a, b) => a.value - b.value);
    const n = rows.length;
    const w = factor.weight ?? (weightTotal > 0 ? 0 : 1 / factors.length);
    rows.forEach((row, idx) => {
      const pct = (idx + 1) / n;
      const score = (factor.direction === -1 ? 1 - pct : pct) * 100;
      scoreSum.set(row.code, (scoreSum.get(row.code) ?? 0) + score * w);
    });
  });
  return [...scoreSum.entries()]
    .map(([code, sum]) => ({ code, score: +sum.toFixed(4) }))
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
}

/* ----- 交易明细 ----- */

export interface StrategyTrade {
  /** 交易日 YYYYMMDD */
  date: number;
  /** 证券代码 000002.XSHE */
  code: string;
  direction: 'buy' | 'sell';
  /** 成交价（执行价：开盘或收盘，前复权） */
  price: number;
  shares: number;
  /** 成交金额 = price × shares */
  amount: number;
  /** 交易费用（单边费率 × 金额） */
  fee: number;
  /** 触发原因：调仓建仓 / 调仓补仓 / 调仓减持 / 调仓卖出 / 止盈 / 止损 / 回撤止盈 / 持有期满 / 条件触发 */
  reason: string;
}

/* ----- 聚合 ----- */

export interface MonthlyReturn {
  /** YYYY-MM */
  month: string;
  /** 当月收益率 % */
  pct: number;
}

export interface StrategyAggregate {
  /** 组合净值曲线（起点 100，2 位小数） */
  curve: number[];
  /** 基准净值曲线（同起点同交易日） */
  benchCurve: number[];
  /** 年化收益 / 最大回撤 / 夏普 / 胜率（百分比口径：14.6 即 14.6%） */
  metrics: RawMetrics;
  /** 年化换手（单边，%）＝ Σ(单边交易额)/Σ(日权益) × (252/天数) × 100 */
  annualTurnoverPct: number;
  /** 基准年化收益（%） */
  benchAnnual: number;
  /** 月度收益（按自然月复合） */
  monthlyReturns: MonthlyReturn[];
}

/**
 * 由逐日权益序列与基准日收益序列聚合并展示指标。
 * @param equities     逐日权益（与交易日一一对应，首个交易日通常 = 初始资金）
 * @param benchReturns 基准日收益序列（与交易日对齐；缺行情按 0）
 * @param dates        逐日交易日 YYYYMMDD（与 equities 等长；月度归因按自然月切分用）
 */
export function aggregateNav(equities: number[], benchReturns: number[], dates: number[]): StrategyAggregate {
  const initial = equities[0] ?? 0;
  const curve = equities.map((v) => (initial > 0 ? +((v / initial) * 100).toFixed(2) : 100));
  const benchCurve = compound(benchReturns);
  const n = equities.length - 1; // 日收益个数（首日为基期）
  const returns: number[] = [];
  for (let i = 1; i < equities.length; i++) {
    returns.push(equities[i - 1] > 0 ? equities[i] / equities[i - 1] - 1 : 0);
  }
  const years = n / 252;
  const end = curve[curve.length - 1] ?? 100;
  const benchEnd = benchCurve[benchCurve.length - 1] ?? 100;
  const annual = n > 0 && years > 0 && end > 0 ? (Math.pow(end / 100, 1 / years) - 1) * 100 : 0;
  const benchAnnual = n > 0 && years > 0 && benchEnd > 0 ? (Math.pow(benchEnd / 100, 1 / years) - 1) * 100 : 0;

  const mean = n > 0 ? returns.reduce((a, r) => a + r, 0) / n : 0;
  const variance = n > 1 ? returns.reduce((a, r) => a + (r - mean) ** 2, 0) / n : 0;
  const std = Math.sqrt(variance);
  const sharpe = std > 1e-12 ? (mean / std) * Math.sqrt(252) : 0;
  const winRate = n > 0 ? (returns.filter((r) => r > 0).length / n) * 100 : 0;

  return {
    curve,
    benchCurve,
    metrics: { annual: round2(annual), drawdown: maxDrawdownPct(curve), sharpe: round2(sharpe), winRate: round2(winRate) },
    annualTurnoverPct: 0, // 由实现层按交易额/权益填入（聚合层无交易数据）
    benchAnnual: round2(benchAnnual),
    monthlyReturns: monthlyReturns(dates, equities),
  };
}

/** 逐日双边交易额 → 年化单边换手 %：Σ(双边交易额)/2 ÷ Σ(日权益) × (252/天数) × 100 */
export function annualizeTurnover(turnoverByDay: number[], equities: number[]): number {
  const n = equities.length;
  if (!n || !turnoverByDay.length) return 0;
  const totalTurnover = turnoverByDay.reduce((a, t) => a + t, 0) / 2; // 买+卖双边合计 → 单边
  // 分母必须是平均权益：用 Σ(每日权益) 当分母，结果会多除 n 倍天数
  // （659 天回测把年化 ~1500% 显示成 +4%，2026-10-13 实测抓到）
  const meanEquity = equities.reduce((a, v) => a + v, 0) / n;
  if (meanEquity <= 0) return 0;
  // 单边年化换手% = 累计单边成交 / 平均权益 / 年数（n/252）
  return round2((totalTurnover / meanEquity) * (252 / n) * 100);
}

/** 月度收益（按自然月复合）：dates/equities 等长对齐，月末相对上月末（首月基期为初始权益） */
export function monthlyReturns(dates: number[], equities: number[]): MonthlyReturn[] {
  if (!dates.length || dates.length !== equities.length) return [];
  const out: MonthlyReturn[] = [];
  let lastEquity = equities[0];
  let lastMonth = '';
  for (let i = 0; i < dates.length; i++) {
    const month = String(dates[i]).slice(0, 6);
    if (month !== lastMonth) {
      if (lastMonth && lastEquity > 0) {
        out.push({ month: fmtMonth(lastMonth), pct: round2((equities[i - 1] / lastEquity - 1) * 100) });
      }
      lastMonth = month;
      lastEquity = i === 0 ? equities[0] : equities[i - 1];
    }
  }
  if (lastMonth && lastEquity > 0) {
    out.push({ month: fmtMonth(lastMonth), pct: round2((equities[equities.length - 1] / lastEquity - 1) * 100) });
  }
  return out;
}

function fmtMonth(yyyymm: string): string {
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}

/** 日收益 → 净值曲线（起点 100，保留 2 位小数） */
function compound(returns: number[]): number[] {
  let nav = 100;
  return returns.map((r) => +(nav *= 1 + r).toFixed(2));
}

function round2(v: number): number {
  return +v.toFixed(2);
}

/* ----- 历史持仓详情：按调仓期聚合（对标果仁"历史持仓详情"面板） ----- */

export interface StrategyPeriodRow {
  /** 期序（1 起） */
  seq: number;
  /** 开始日期 YYYYMMDD */
  startDate: number;
  /** 结束日期 YYYYMMDD */
  endDate: number;
  /** 期间平均目标仓位 %（无择时恒 100） */
  positionPct: number;
  /** 期末持仓只数 */
  stockCount: number;
  /** 期间买入只数（去重） */
  buyCount: number;
  /** 期间卖出只数（去重） */
  sellCount: number;
  /** 期间换手 %（单边成交 ÷ 期间平均权益） */
  turnoverPct: number;
  /** 本期收益 %（期末权益/期初权益-1；首期基期为初始资金） */
  periodReturnPct: number;
  /** 基准收益 %（同期复合） */
  benchReturnPct: number;
  /** 超额收益 % = 本期 - 基准 */
  excessPct: number;
  /** 1000 元投资累计净值（按各期收益复利） */
  cumulativeValue: number;
}

/**
 * 按调仓期聚合逐日数据 → 历史持仓详情行。
 * @param periodStarts 每期起始交易日下标（升序，含首期；末期止于最后交易日）
 * @param exposureByDay 逐日目标仓位 %（无择时传全 100）
 */
export function aggregatePeriodRows(opts: {
  tradeDates: number[];
  equities: number[];
  benchReturns: number[];
  turnoverByDay: number[];
  trades: StrategyTrade[];
  periodStarts: number[];
  exposureByDay: number[];
  initialCapital: number;
}): StrategyPeriodRow[] {
  const { tradeDates, equities, benchReturns, turnoverByDay, trades, exposureByDay, initialCapital } = opts;
  const starts = [...opts.periodStarts].sort((a, b) => a - b).filter((i) => i >= 0 && i < tradeDates.length);
  if (!starts.length || tradeDates.length < 2) return [];

  // 按日聚合交易流水：买卖代码集合（去重）+ 逐日净持仓股数（期末只数快照用）
  const tradesByDay = new Map<number, StrategyTrade[]>();
  for (const t of trades) {
    const list = tradesByDay.get(t.date);
    if (list) list.push(t);
    else tradesByDay.set(t.date, [t]);
  }
  const netShares = new Map<string, number>();
  const buyByDay = new Map<number, Set<string>>();
  const sellByDay = new Map<number, Set<string>>();
  const endCountByDay: number[] = [];
  for (let i = 0; i < tradeDates.length; i++) {
    const day = tradeDates[i];
    const list = tradesByDay.get(day) ?? [];
    const buys = new Set<string>();
    const sells = new Set<string>();
    for (const t of list) {
      netShares.set(t.code, (netShares.get(t.code) ?? 0) + (t.direction === 'buy' ? t.shares : -t.shares));
      (t.direction === 'buy' ? buys : sells).add(t.code);
    }
    buyByDay.set(day, buys);
    sellByDay.set(day, sells);
    let c = 0;
    for (const v of netShares.values()) if (v > 0) c++;
    endCountByDay.push(c);
  }

  const out: StrategyPeriodRow[] = [];
  let cum = 1000;
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    const e = k + 1 < starts.length ? starts[k + 1] - 1 : tradeDates.length - 1;
    if (e < s) continue;
    const startDay = tradeDates[s];
    const endDay = tradeDates[e];

    const baseEquity = k === 0 ? initialCapital : equities[s - 1];
    const periodReturnPct = baseEquity > 0 ? (equities[e] / baseEquity - 1) * 100 : 0;
    let b = 1;
    for (let i = s; i <= e; i++) b *= 1 + (benchReturns[i] ?? 0);
    const benchReturnPct = (b - 1) * 100;

    let turnover = 0;
    let meanEquity = 0;
    for (let i = s; i <= e; i++) {
      turnover += turnoverByDay[i] ?? 0;
      meanEquity += equities[i] ?? 0;
    }
    meanEquity /= e - s + 1;
    const turnoverPct = meanEquity > 0 ? ((turnover / 2) / meanEquity) * 100 : 0;

    const buyCodes = new Set<string>();
    const sellCodes = new Set<string>();
    for (let i = s; i <= e; i++) {
      const day = tradeDates[i];
      for (const c of buyByDay.get(day) ?? []) buyCodes.add(c);
      for (const c of sellByDay.get(day) ?? []) sellCodes.add(c);
    }

    let posSum = 0;
    for (let i = s; i <= e; i++) posSum += exposureByDay[i] ?? 100;
    const positionPct = +(posSum / (e - s + 1)).toFixed(1);

    cum = cum * (1 + periodReturnPct / 100);
    const periodReturnRounded = +periodReturnPct.toFixed(2);
    const benchRounded = +benchReturnPct.toFixed(2);

    out.push({
      seq: out.length + 1,
      startDate: startDay,
      endDate: endDay,
      positionPct,
      stockCount: endCountByDay[e] ?? 0,
      buyCount: buyCodes.size,
      sellCount: sellCodes.size,
      turnoverPct: +turnoverPct.toFixed(2),
      periodReturnPct: periodReturnRounded,
      benchReturnPct: benchRounded,
      excessPct: +(periodReturnRounded - benchRounded).toFixed(2),
      cumulativeValue: +cum.toFixed(2),
    });
  }
  return out;
}

/* ----- 旧等权配置 → 新引擎入参（策略库 backtestConfig 重跑适配） ----- */

/** 旧 8 档频率 → 每 N 个交易日（custom 用 everyNTd） */
const FREQUENCY_TO_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 5,
  biweekly: 10,
  monthly: 21,
  quarterly: 63,
  semiannual: 126,
  annual: 252,
};

/**
 * 策略库旧等权配置（BacktestRunConfig）→ 新引擎入参：
 * factors → sortFactors（order desc → direction 1）、frequency → rebalanceIntervalDays、
 * topK → maxPositions；无过滤无卖出规则、全市场股票池——即旧调用的语义特例。
 */
export function legacyConfigToInput(config: {
  factors: { table: string; field: string; order: 'desc' | 'asc' }[];
  startDate: string;
  endDate: string;
  frequency: string;
  everyNTd?: number;
  topK: number;
  benchmark?: string;
  feeRate?: number;
}): StrategyBacktestInput {
  const interval = config.frequency === 'custom'
    ? config.everyNTd
    : FREQUENCY_TO_DAYS[config.frequency];
  return {
    sortFactors: config.factors.map((f) => ({ table: f.table, field: f.field, direction: f.order === 'asc' ? -1 : 1 })),
    startDate: config.startDate,
    endDate: config.endDate,
    rebalanceIntervalDays: interval,
    maxPositions: config.topK,
    benchmark: config.benchmark,
    feeRate: config.feeRate ?? 0,
  };
}

/* ----- 回测产物 ----- */

/** 回测产物：前端卡片 + 给 LLM 的文字摘要 + 原始指标（策略库等数字消费方使用） */
export interface StrategyBacktestOutput {
  card: BacktestCard;
  summary: Record<string, unknown>;
  /** RawMetrics 口径（annual/drawdown/sharpe/winRate，已四舍五入），与 card.metrics 展示串同源 */
  metrics: RawMetrics;
}

/* ----- 契约 ----- */

/**
 * 策略回测：输入 StrategySpec v1 数字参数，输出净值卡片（含交易明细/月度归因）与给模型的摘要。
 * 取数全部经 FactorDataService（交易日历/因子截面/行情/基准），本层不触库。
 * onProgress 可选：长阶段（信号预计算/行情拉取）内部发批次进度事件（复用工具事件形状），
 * 前端步骤条照常渲染；不传则行为与无进度时完全一致。
 */
@Injectable()
export abstract class StrategyBacktestService {
  abstract runStrategyBacktest(input: StrategyBacktestInput, onProgress?: AgentProgressSink): Promise<StrategyBacktestOutput>;

  /** 执行前快检（实现层做字典白名单校验）：确认门在 interrupt 之前调用，
   *  让"字段不存在"这类注定失败的提案在用户确认前就被打回给模型自纠，
   *  避免用户确认一轮之后引擎才报错、又得重新确认一轮 */
  abstract preflight(refs: FactorRef[]): void;

  /** 区间快检 + 回测日历（实现层）：回测区间越界即抛 INVALID_ARGUMENT（文案含可用区间）。
   *  确认门在 interrupt 前调用它（忽略返回值）——区间超界的提案同样先打回模型自纠，
   *  否则用户确认后引擎才报错、模型改参重发又要再确认一轮；
   *  引擎主流程调用它拿交易日历。两次调用命中取数缓存，确认门预热后引擎同区间读取零打库 */
  abstract checkRange(input: StrategyBacktestInput): Promise<TradeDateCoverage>;
}

/** 指标数组组装（供实现层拼卡片 metrics：四项绩效 + 年化换手） */
export function toStrategyMetricItems(agg: StrategyAggregate): { label: string; value: string; cls?: string }[] {
  return [
    ...toMetricItems(agg.metrics),
    { label: '年化换手(单边)', value: formatPct(agg.annualTurnoverPct, 0), cls: '' },
  ];
}

/** +12.3% / -4.5% 形态的百分比展示 */
export function formatPct(v: number, digits = 1): string {
  return (v > 0 ? '+' : '') + v.toFixed(digits) + '%';
}

/** YYYYMMDD → 'YYYY-MM-DD'（行情表 DATE 列参数与展示） */
export function toDashDate(yyyymmdd: number | string): string {
  const s = String(yyyymmdd);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
