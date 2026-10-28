import type { StrategyTrade } from './strategy-backtest.service';

/* ==========================================================
   归因聚合器（纯函数，ADR-0010 配套）：
   个股贡献（FIFO 全口径）/ 卖出规则贡献 / 亏损行为四分类 /
   回撤窗口 / 尾部集中度。输入 = 全量流水 + 交易日历 + 收盘查询；
   不触引擎、不触库。
   ========================================================== */

/** 交易日序列内的收盘查询：dayIdx 越界/停牌返回 undefined */
export type CloseLookup = (code: string, dayIdx: number) => number | undefined;

export interface ClosedBatch {
  code: string;
  /** 开仓/平仓的交易日下标 */
  openDayIdx: number;
  closeDayIdx: number;
  shares: number;
  entry: number;
  exit: number;
  /** (exit − entry) × shares，费用单列不摊（批次口径） */
  pnl: number;
  /** 持有期内最大浮盈 %（按日收盘，相对 entry） */
  mfePct: number;
  /** 持有期内最大浮亏 %（负数） */
  maePct: number;
  /** 触发规则（卖出流水 reason） */
  reason: string;
}

/** FIFO 配对：同码买卖按先进先出拆平仓批次；
 *  批次内按日收盘扫描 MFE/MAE（缺收盘日跳过，不中断扫描） */
export function closeBatches(
  trades: StrategyTrade[],
  dayIndexOf: (date: number) => number | undefined,
  closeOf: CloseLookup,
): ClosedBatch[] {
  const lots = new Map<string, Array<{ shares: number; entry: number; openDayIdx: number }>>();
  const out: ClosedBatch[] = [];
  const sorted = [...trades].sort((a, b) => a.date - b.date);
  for (const t of sorted) {
    const di = dayIndexOf(t.date);
    if (di === undefined) continue;
    const code = t.code;
    if (t.direction === 'buy') {
      const arr = lots.get(code) ?? [];
      arr.push({ shares: t.shares, entry: t.price, openDayIdx: di });
      lots.set(code, arr);
      continue;
    }
    let remain = t.shares;
    const arr = lots.get(code) ?? [];
    while (remain > 0 && arr.length) {
      const lot = arr[0];
      const take = Math.min(remain, lot.shares);
      // 持有窗 [open, close] 内扫 MFE/MAE（按日收盘）
      let mfe = -Infinity;
      let mae = Infinity;
      for (let d = lot.openDayIdx; d <= di; d++) {
        const c = closeOf(code, d);
        if (c === undefined) continue;
        mfe = Math.max(mfe, (c / lot.entry - 1) * 100);
        mae = Math.min(mae, (c / lot.entry - 1) * 100);
      }
      out.push({
        code,
        openDayIdx: lot.openDayIdx,
        closeDayIdx: di,
        shares: take,
        entry: lot.entry,
        exit: t.price,
        pnl: (t.price - lot.entry) * take,
        mfePct: Number.isFinite(mfe) ? mfe : 0,
        maePct: Number.isFinite(mae) ? mae : 0,
        reason: t.reason,
      });
      remain -= take;
      lot.shares -= take;
      if (lot.shares <= 0) arr.shift();
    }
    lots.set(code, arr);
  }
  return out;
}

export interface StockContribution {
  code: string;
  /** 已实现盈亏（FIFO 平仓批次合计） */
  realized: number;
  /** 期末浮盈（正）/浮亏（负），由调用方以期末持仓补齐 */
  floating: number;
  /** 全口径合计 = realized + floating */
  total: number;
  /** 平仓批次与胜率 */
  batches: number;
  winRatePct: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/** 个股已实现贡献：FIFO 批次合计按码聚合（期末浮动由调用方以期末持仓补齐） */
export function realizedByCode(batches: ClosedBatch[]): StockContribution[] {
  const byCode = new Map<string, { realized: number; batches: number; wins: number }>();
  for (const b of batches) {
    const e = byCode.get(b.code) ?? { realized: 0, batches: 0, wins: 0 };
    e.realized += b.pnl;
    e.batches += 1;
    if (b.pnl > 0) e.wins += 1;
    byCode.set(b.code, e);
  }
  return [...byCode.entries()]
    .map(([code, e]) => ({
      code,
      realized: round2(e.realized),
      floating: 0,
      total: round2(e.realized),
      batches: e.batches,
      winRatePct: e.batches ? round2((e.wins / e.batches) * 100) : 0,
    }))
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

/** 卖出规则贡献：按 reason 分组的笔数/已实现盈亏/平均持有天数 */
export interface RuleContribution {
  reason: string;
  count: number;
  realized: number;
  avgHoldingDays: number;
}

export function ruleContributions(batches: ClosedBatch[]): RuleContribution[] {
  const by = new Map<string, { count: number; pnl: number; days: number[] }>();
  for (const b of batches) {
    const e = by.get(b.reason) ?? { count: 0, pnl: 0, days: [] as number[] };
    e.count += 1;
    e.pnl += b.pnl;
    e.days.push(b.closeDayIdx - b.openDayIdx);
    by.set(b.reason, e);
  }
  return [...by.entries()]
    .map(([reason, e]) => ({
      reason,
      count: e.count,
      realized: round2(e.pnl),
      avgHoldingDays: e.days.length ? round(e.days.reduce((a, b) => a + b, 0) / e.days.length) : 0,
    }))
    .sort((a, b) => Math.abs(b.realized) - Math.abs(a.realized));
}

const round = (v: number) => Math.round(v * 10) / 10;

/* ----- 亏损行为四分类（阈值可配，缺省见注释） ----- */

export interface BehaviorThresholds {
  /** 买错：入场后 lookDays 内最大浮盈 ≤ neverProfitPct% */
  lookDays: number;
  neverProfitPct: number;
  /** 卖晚：曾有浮盈 ≥ onceProfitPct% 但亏损离场（利润回吐） */
  onceProfitPct: number;
  /** 卖早：卖出后 postDays 内该票涨幅 ≥ reboundPct% */
  postDays: number;
  reboundPct: number;
}

export const DEFAULT_BEHAVIOR_THRESHOLDS: BehaviorThresholds = {
  lookDays: 10,
  neverProfitPct: 2,
  onceProfitPct: 5,
  postDays: 5,
  reboundPct: 5,
};

export type LossBehavior = '买错' | '卖晚' | '卖早' | '其他';

export interface BehaviorAttribution {
  counts: Record<LossBehavior, number>;
  lossAmount: Record<LossBehavior, number>;
}

/** 亏损行为四分类（只对亏损批次分类）。优先级：买错 > 卖晚 > 卖早 > 其他 */
export function lossBehaviorAttribution(
  batches: ClosedBatch[],
  thresholds: BehaviorThresholds = DEFAULT_BEHAVIOR_THRESHOLDS,
): BehaviorAttribution {
  const counts: Record<LossBehavior, number> = { 买错: 0, 卖晚: 0, 卖早: 0, 其他: 0 };
  const lossAmount: Record<LossBehavior, number> = { 买错: 0, 卖晚: 0, 卖早: 0, 其他: 0 };
  for (const b of batches) {
    if (b.pnl >= 0) continue;
    let cat: LossBehavior;
    if (b.mfePct <= thresholds.neverProfitPct) cat = '买错';
    else if (b.mfePct >= thresholds.onceProfitPct) cat = '卖晚';
    else cat = '其他';
    counts[cat] += 1;
    lossAmount[cat] += -b.pnl;
  }
  return { counts, lossAmount };
}

/* ----- 回撤窗口 ----- */

export interface DrawdownWindow {
  peakIdx: number;
  troughIdx: number;
  /** 恢复日下标（未修复 = -1） */
  recoverIdx: number;
  depthPct: number;
  days: number;
}

function troughVal(equities: number[], from: number, to: number): number {
  let m = Infinity;
  for (let i = from; i <= to; i++) m = Math.min(m, equities[i]);
  return m;
}

/** 权益曲线回撤窗切分（峰→谷→修复）：深度 ≥ minDepthPct% 才计入；曲线末尾未修复窗也输出（recoverIdx=-1） */
export function drawdownWindows(equities: number[], minDepthPct = 3): DrawdownWindow[] {
  const out: DrawdownWindow[] = [];
  let peak = equities[0] ?? 0;
  let peakIdx = 0;
  let troughIdx = 0;
  let inDd = false;
  for (let i = 1; i < equities.length; i++) {
    const v = equities[i];
    if (v >= peak) {
      if (inDd) {
        out.push({
          peakIdx,
          troughIdx,
          recoverIdx: i,
          depthPct: ((peak - troughVal(equities, peakIdx, i)) / peak) * 100,
          days: i - peakIdx,
        });
        inDd = false;
      }
      peak = v;
      peakIdx = i;
    } else if (!inDd) {
      inDd = true;
      troughIdx = i;
    } else if (v < equities[troughIdx]) {
      troughIdx = i;
    }
  }
  if (inDd) {
    out.push({
      peakIdx,
      troughIdx,
      recoverIdx: -1,
      depthPct: ((peak - troughVal(equities, peakIdx, equities.length - 1)) / peak) * 100,
      days: equities.length - 1 - peakIdx,
    });
  }
  return out.filter((w) => w.depthPct >= minDepthPct);
}

/* ----- 尾部与集中度 ----- */

export interface TailStats {
  /** 最差 5 笔占总已实现亏损比 % */
  top5SharePct: number;
  /** 最大单笔亏损 */
  maxLoss: number;
  /** 最大连亏批次数 */
  maxLossStreak: number;
  /** 盈亏比 = 平均盈利 / |平均亏损|（无亏损批次 = -1） */
  profitLossRatio: number;
}

export function tailStats(batches: ClosedBatch[]): TailStats {
  const losses = batches.filter((b) => b.pnl < 0).map((b) => -b.pnl).sort((a, b) => b - a);
  const wins = batches.filter((b) => b.pnl > 0).map((b) => b.pnl);
  const totalLoss = losses.reduce((a, b) => a + b, 0);
  const top5 = losses.slice(0, 5).reduce((a, b) => a + b, 0);
  let streak = 0;
  let maxStreak = 0;
  const ordered = [...batches].sort((a, b) => a.closeDayIdx - b.closeDayIdx);
  for (const b of ordered) {
    if (b.pnl < 0) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else streak = 0;
  }
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLoss = losses.length ? totalLoss / losses.length : 0;
  return {
    top5SharePct: totalLoss > 0 ? round((top5 / totalLoss) * 100) : 0,
    maxLoss: losses.length ? round2(losses[0]) : 0,
    maxLossStreak: maxStreak,
    profitLossRatio: avgLoss > 0 ? round(avgWin / avgLoss) : -1,
  };
}

/* ----- 编排入口：引擎回测后一次性调用（输入全部来自回测内部状态） ----- */

export interface AttributionSummary {
  /** 个股贡献（全口径=已实现+期末浮动，按 |total| 降序） */
  stocks: Array<StockContribution & { shares?: number; entryPrice?: number; lastClose?: number }>;
  rules: RuleContribution[];
  behavior: BehaviorAttribution;
  drawdowns: DrawdownWindow[];
  tail: TailStats;
}

export interface AttributionInput {
  trades: StrategyTrade[];
  /** 交易日（YYYYMMDD，与 equities 等长同序） */
  dates: number[];
  equities: number[];
  /** (code, dates 下标) → 当日收盘（停牌 undefined） */
  closeAt: (code: string, dayIdx: number) => number | undefined;
  finalPositions: ReadonlyMap<string, { shares: number; entryPrice: number }>;
  lastClose: ReadonlyMap<string, number>;
}

/** 归因聚合总入口：个股全口径（FIFO 已实现 + 期末浮动）/ 规则分组 / 亏损行为四分类 / 回撤窗 / 尾部集中度 */
export function buildAttribution(input: AttributionInput): AttributionSummary {
  const dayIndexOf = (date: number): number | undefined => {
    const i = input.dates.indexOf(date);
    return i === -1 ? undefined : i;
  };
  const closeOf: CloseLookup = (code, dayIdx) => input.closeAt(code, dayIdx);
  const batches = closeBatches(input.trades, dayIndexOf, closeOf);

  const byCode = new Map<string, { realized: number; batches: number; wins: number }>();
  for (const b of batches) {
    const e = byCode.get(b.code) ?? { realized: 0, batches: 0, wins: 0 };
    e.realized += b.pnl;
    e.batches += 1;
    if (b.pnl > 0) e.wins += 1;
    byCode.set(b.code, e);
  }

  const stocks: AttributionSummary['stocks'] = [];
  const codes = new Set([...byCode.keys(), ...input.finalPositions.keys()]);
  for (const code of codes) {
    const agg = byCode.get(code);
    const pos = input.finalPositions.get(code);
    const lastClose = input.lastClose.get(code);
    const realized = agg ? round2(agg.realized) : 0;
    const floating = pos && lastClose !== undefined ? round2(pos.shares * (lastClose - pos.entryPrice)) : 0;
    stocks.push({
      code,
      realized,
      floating,
      total: round2(realized + floating),
      batches: agg?.batches ?? 0,
      winRatePct: agg && agg.batches ? round2((agg.wins / agg.batches) * 100) : 0,
      shares: pos?.shares,
      entryPrice: pos?.entryPrice,
      lastClose: lastClose !== undefined ? lastClose : undefined,
    });
  }
  stocks.sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  return {
    stocks,
    rules: ruleContributions(batches),
    behavior: lossBehaviorAttribution(batches),
    drawdowns: drawdownWindows(input.equities, 3),
    tail: tailStats(batches),
  };
}
