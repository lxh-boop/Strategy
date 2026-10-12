import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import {
  aggregateNav,
  annualizeTurnover,
  applyEntryFilters,
  assertStrategyInput,
  BENCHMARKS,
  collectFactorRefs,
  DEFAULT_MOMENTUM_FACTOR,
  describeFilters,
  describeSellRules,
  describeSortFactors,
  effectiveSortFactors,
  FactorRef,
  formatPct,
  LIMIT_DOWN_RATIO,
  LIMIT_UP_RATIO,
  LOT_SIZE,
  MAX_CANDIDATE_UNIVERSE,
  MAX_REBALANCES,
  NormalizedStrategyInput,
  rankUniverse,
  StrategyAggregate,
  StrategyBacktestInput,
  StrategyBacktestOutput,
  StrategyBacktestService,
  StrategySellRule,
  StrategySortFactor,
  StrategyTrade,
  toDashDate,
  toStrategyMetricItems,
} from '../strategy-backtest.service';
import { FactorDataService } from '../factor-data.service';
import { loadTableFields, listKnownTables } from '../factor-schema';

/* ==========================================================
   策略回测实现：日频事件驱动内核——只编排与模拟，不触库。
   全部数据经 FactorDataService 批量方法取数（连接池/白名单由其负责）。

   两遍法内存口径：
   第一遍（信号）只读因子截面——逐调仓日取 entryFilters/sortFactors 引用字段的
   当日截面，算出每个调仓日的有序候选（≤ maxPositions）；全程不碰行情。
   第二遍（执行）只拉"涉及股票"（各调仓日候选的并集，≤ MAX_CANDIDATE_UNIVERSE）的
   前复权日线与 field 类卖出规则的区间序列，然后跑主循环。
   全市场 × 全区间的行情面板从不进入内存。

   主循环（逐交易日）：执行（昨日指令：先卖后买，整手/费用/T+1/停牌顺延/涨跌停顺延）
   → 结算（权益 = 现金 + Σ持仓×收盘，停牌用最近有效收盘估值）→ 信号（卖出规则逐持仓
   检查、调仓日落目标持仓），指令次日执行——无未来函数。
   ========================================================== */

/** 引擎工作日：交易日数组的下标 */
type DayIdx = number;

/** 指数日行情表（SQL/mkt_idxd.md），基准曲线数据源 */
const INDEX_TABLE = 'mkt_idxd';

interface Quote {
  open: number | null;
  close: number;
  preClose: number;
}

interface Position {
  code: string;
  shares: number;
  /** 最近一次买入的成交价（补仓按股数加权；T+1 简化按整仓最近买入日锁定） */
  entryPrice: number;
  /** 最近买入日的交易日下标（当日不可卖） */
  buyDayIdx: DayIdx;
  /** 买入以来最高收盘（max_drawdown_from_entry 用，含买入日） */
  peakClose: number;
}

interface RebalanceSignal {
  /** 有序候选（综合分降序，≤ maxPositions）；空 = 当日因子全缺，沿用持仓不换仓 */
  candidates: string[];
  /** 过滤后存活池的综合分排名（1 起）；rank_out 判断"持仓跌出 bottomN"用 */
  compositeRank: Map<string, number>;
}

/** field 类卖出规则的预取数据：按日表（code → 交易日 → 值）；静态表（code → 值，与日期无关） */
type SellFieldData = Map<string, Map<string, Map<number, number>> | Map<string, number>>;

@Injectable()
export class StrategyBacktestServiceImpl extends StrategyBacktestService {
  private readonly logger = new Logger('StrategyBacktest');

  constructor(private readonly factorData: FactorDataService) {
    super();
  }

  /** 执行前快检：字典白名单（确认门 interrupt 前调用，让坏因子在用户确认前被打回，见契约注释） */
  preflight(refs: FactorRef[]): void {
    this.assertWhitelist(refs);
  }

  async runStrategyBacktest(input: StrategyBacktestInput): Promise<StrategyBacktestOutput> {
    const p = assertStrategyInput(input);
    const refs = collectFactorRefs(p);
    this.assertWhitelist(refs);
    const sortFactors = effectiveSortFactors(p.sortFactors);
    const fieldSellRules = p.sellRules.filter((r): r is Extract<StrategySellRule, { kind: 'field' }> => r.kind === 'field');
    const rankOutBottomN: number | null = p.sellRules.some((r) => r.kind === 'rank_out')
      ? Math.min(...p.sellRules.filter((r) => r.kind === 'rank_out').map((r) => r.bottomN))
      : null;

    // ① 回测日历：区间内交易日 + 全表可用范围校验（日历源 = 首个被引用因子表，缺省用默认动量表）
    const calendarTable = refs[0]?.table ?? DEFAULT_MOMENTUM_FACTOR.table;
    const coverage = await this.factorData.readTradeDates(calendarTable, p.startDate, p.endDate);
    if (Number(p.startDate) < coverage.min || Number(p.endDate) > coverage.max) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `回测区间超出数据范围：${calendarTable} 可用区间 ${coverage.min}~${coverage.max}，请调整 startDate/endDate`,
      );
    }
    const tradeDates = coverage.dates;
    if (tradeDates.length < 2) {
      throw new ApiException('INVALID_ARGUMENT', 400, `区间 ${p.startDate}~${p.endDate} 内交易日不足（${tradeDates.length} 天），无法回测`);
    }
    // 调仓日：从区间第一个交易日起每 N 个交易日（下标 0, N, 2N, ...）
    const rebalanceIdx: DayIdx[] = [];
    for (let i = 0; i < tradeDates.length; i += p.rebalanceIntervalDays) rebalanceIdx.push(i);
    if (rebalanceIdx.length > MAX_REBALANCES) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `调仓次数过多：${rebalanceIdx.length} 次（上限 ${MAX_REBALANCES}，约两年日频）。请缩短区间或加大调仓间隔`,
      );
    }

    // ② 第一遍（信号）：逐调仓日取因子截面 → 过滤 → 排序合成 → 有序候选；累计涉及股票
    const signals = new Map<DayIdx, RebalanceSignal>();
    const involved = new Set<string>(p.securityIds ?? []);
    for (const idx of rebalanceIdx) {
      const date = String(tradeDates[idx]);
      const sections = await Promise.all(
        refs.map((ref) => this.factorData.readFactorSection(ref.table, ref.field, date, p.securityIds)),
      );
      const byRef = new Map<string, Map<string, number>>();
      refs.forEach((ref, i) => {
        byRef.set(`${ref.table}.${ref.field}`, new Map(sections[i].map((r) => [r.securityId, r.value])));
      });
      // 过滤池：全市场时取全部截面键的并集（缺值股票由过滤/合成逻辑剔除）
      const rawPool = p.securityIds ?? [...new Set(sections.flat().map((r) => r.securityId))];
      const sectionMaps = refs.map((ref) => byRef.get(`${ref.table}.${ref.field}`)!);
      const pool = applyEntryFilters(rawPool, p.entryFilters, sectionMaps);
      const ranked = rankUniverse(sortFactors.factors, sectionMaps, pool);
      const candidates = ranked.slice(0, p.maxPositions).map((r) => r.code);
      const compositeRank = new Map(ranked.map((r, i) => [r.code, i + 1]));
      signals.set(idx, { candidates, compositeRank });
      for (const code of candidates) involved.add(code);
    }
    const rebalanceCount = [...signals.values()].filter((s) => s.candidates.length > 0).length;
    if (rebalanceCount === 0) {
      throw new ApiException('INVALID_ARGUMENT', 400, '全部调仓日均无可用候选（因子截面为空或全被过滤），请调整因子/过滤条件/区间');
    }
    if (involved.size > MAX_CANDIDATE_UNIVERSE) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `候选股票并集过大（${involved.size} 只，上限 ${MAX_CANDIDATE_UNIVERSE}）：请降低调仓频率、减少持仓只数或缩短区间`,
      );
    }
    this.logger.log(
      `信号预计算完成：${rebalanceIdx.length} 个调仓日，涉及股票 ${involved.size} 只` +
        `${sortFactors.usedDefault ? '（排序因子缺省 → 默认 20 日动量值大优）' : ''}`,
    );

    // ③ 第二遍（执行）预取：涉及股票的前复权日线 + field 类卖出规则区间序列 + 基准
    // 行情装载即做脏数据防御：close/preClose 非正数的行丢弃（等同停牌），
    // open 非正数置 null（该日不可开盘成交）——杜绝除零/NaN 顺着资金账户扩散
    const quotes = new Map<string, Map<number, Quote>>();
    const quoteRows = await this.factorData.readQuoteSeries([...involved], p.startDate, p.endDate);
    for (const row of quoteRows) {
      if (!(row.close > 0) || !(row.preClose > 0)) continue;
      const code = `${row.ticker}.${row.exchange}`;
      let byDate = quotes.get(code);
      if (!byDate) {
        byDate = new Map<number, Quote>();
        quotes.set(code, byDate);
      }
      byDate.set(Number(row.tradeDate.replaceAll('-', '')), {
        open: row.open !== null && row.open > 0 ? row.open : null,
        close: row.close,
        preClose: row.preClose,
      });
    }
    const sellFieldSeries = await this.fetchSellFieldSeries(fieldSellRules, [...involved], p);

    const bench = BENCHMARKS[p.benchmark];
    const indexRows = await this.factorData.readIndexDaily(INDEX_TABLE, bench.ticker, p.startDate, p.endDate);
    const indexByDate = new Map(indexRows.map((r) => [r.tradeDate, r]));
    const benchReturns = tradeDates.map((day) => {
      const row = indexByDate.get(toDashDate(day));
      return row && row.preClose > 0 ? row.close / row.preClose - 1 : 0;
    });

    // ④ 主循环（逐交易日：执行 → 结算 → 信号）
    const loop = this.runMainLoop(p, tradeDates, rebalanceIdx, signals, quotes, sellFieldSeries, sortFactors.factors, rankOutBottomN);

    // ⑤ 聚合 → 卡片 + 摘要
    const aggregate = aggregateNav(loop.equities, benchReturns, tradeDates);
    aggregate.annualTurnoverPct = annualizeTurnover(loop.turnoverByDay, loop.equities);
    const card = this.buildCard(p, aggregate, loop, tradeDates, coverage, bench, sortFactors, rebalanceIdx.length);
    const summary = this.buildSummary(p, aggregate, loop, bench, rebalanceIdx.length, sortFactors);
    this.logger.log(
      `策略回测 ${p.startDate}~${p.endDate} 每${p.rebalanceIntervalDays}交易日: ` +
        `年化=${summary.年化收益} 回撤=${summary.最大回撤} 夏普=${summary.夏普比率} 交易 ${loop.trades.length} 笔 费用 ${summary.总费用}`,
    );
    return { card, summary, metrics: aggregate.metrics };
  }

  /* ----- 主循环：逐交易日 执行 → 结算 → 信号 ----- */

  private runMainLoop(
    p: NormalizedStrategyInput,
    tradeDates: number[],
    rebalanceIdx: DayIdx[],
    signals: Map<DayIdx, RebalanceSignal>,
    quotes: Map<string, Map<number, Quote>>,
    sellFieldSeries: SellFieldData,
    sortFactors: StrategySortFactor[],
    rankOutBottomN: number | null,
  ) {
    const staticSellRefs = new Set(
      p.sellRules.filter((r) => r.kind === 'field').map((r) => `${r.table}.${r.field}`)
        .filter((key) => !this.isDateTable(key.split('.')[0])),
    );

    let cash = p.initialCapital;
    const positions = new Map<string, Position>();
    const trades: StrategyTrade[] = [];
    const equities: number[] = [];
    const turnoverByDay: number[] = [];
    const lastClose = new Map<string, number>();
    let pendingSells = new Map<string, string>(); // code → 触发原因
    let pendingRebalance: RebalanceSignal | null = null;
    let dayTurnover = 0;

    const quoteOf = (code: string, day: number): Quote | undefined => quotes.get(code)?.get(day);
    /** 执行价：0=开盘 1=收盘；停牌/开盘价缺失 → undefined（当日不可交易该标的） */
    const execPriceOf = (code: string, day: number): number | undefined => {
      const q = quoteOf(code, day);
      if (!q) return undefined;
      return p.executionTiming === 0 ? (q.open ?? undefined) : q.close;
    };

    const buy = (code: string, shares: number, price: number, day: number, dayIdx: DayIdx, reason: string) => {
      const amount = shares * price;
      const fee = amount * p.feeRate;
      cash -= amount + fee;
      dayTurnover += amount;
      const pos = positions.get(code);
      if (pos) {
        pos.entryPrice = (pos.entryPrice * pos.shares + price * shares) / (pos.shares + shares);
        pos.shares += shares;
        pos.buyDayIdx = dayIdx; // T+1 简化：整仓按最近买入日锁定
        pos.peakClose = Math.max(pos.peakClose, price);
      } else {
        positions.set(code, { code, shares, entryPrice: price, buyDayIdx: dayIdx, peakClose: price });
      }
      trades.push({ date: day, code, direction: 'buy', price, shares, amount, fee, reason });
    };

    const sell = (pos: Position, shares: number, price: number, day: number, reason: string) => {
      const amount = shares * price;
      const fee = amount * p.feeRate;
      cash += amount - fee;
      dayTurnover += amount;
      pos.shares -= shares;
      if (pos.shares <= 0) positions.delete(pos.code);
      trades.push({ date: day, code: pos.code, direction: 'sell', price, shares, amount, fee, reason });
    };

    const sellAll = (pos: Position, price: number, day: number, reason: string) => sell(pos, pos.shares, price, day, reason);

    const rebalanceIdxSet = new Set(rebalanceIdx);

    for (let i = 0; i < tradeDates.length; i++) {
      const day = tradeDates[i];
      dayTurnover = 0;

      // ── 执行阶段：昨日盘后生成的指令 ──
      if (i > 0) {
        // a. 卖出指令（卖出规则触发）：停牌/跌停顺延，T+1 保护
        for (const [code, reason] of pendingSells) {
          const pos = positions.get(code);
          if (!pos) continue;
          if (pos.buyDayIdx >= i) continue; // T+1：当日买入不可卖
          const price = execPriceOf(code, day);
          const q = quoteOf(code, day);
          if (price === undefined || !q) continue; // 停牌：持仓顺延
          if (price <= q.preClose * LIMIT_DOWN_RATIO) continue; // 跌停顺延
          sellAll(pos, price, day, reason);
        }
        pendingSells = new Map();

        // b. 调仓指令：先卖非目标/强制卖出，再按综合分序买入候选，最后已持有的调回目标仓位
        if (pendingRebalance) {
          const { candidates, compositeRank } = pendingRebalance;
          if (candidates.length) {
            const targetSet = new Set(candidates);
            const equity0 = cash + [...positions.values()].reduce((a, pos) => {
              const px = execPriceOf(pos.code, day) ?? lastClose.get(pos.code) ?? pos.entryPrice;
              return a + pos.shares * px;
            }, 0);
            const minMv = (equity0 * p.minPositionPct) / 100;
            const targetMv = (equity0 * p.idealPositionPct) / 100;

            // b1. 清出不在目标（或被 rank_out 强制卖出）的持仓
            for (const pos of [...positions.values()]) {
              const forced = rankOutBottomN !== null && this.rankOutOf(pos.code, compositeRank, rankOutBottomN);
              if (targetSet.has(pos.code) && !forced) continue;
              if (pos.buyDayIdx >= i) continue; // T+1 保护
              const price = execPriceOf(pos.code, day);
              const q = quoteOf(pos.code, day);
              if (price === undefined || !q) continue; // 停牌顺延：明日重试
              if (price <= q.preClose * LIMIT_DOWN_RATIO) continue; // 跌停顺延
              sellAll(pos, price, day, forced ? '排名跌出' : '调仓卖出');
            }

            // b2. 按综合分序买入未持有的候选：整手向下取整，现金不足缩股，低于最小建仓仓位放弃（顺延下一候选）
            for (const code of candidates) {
              if (positions.has(code)) continue;
              const price = execPriceOf(code, day);
              const q = quoteOf(code, day);
              if (price === undefined || !q) continue; // 停牌跳过
              if (price >= q.preClose * LIMIT_UP_RATIO) continue; // 涨停跳过
              let shares = Math.floor(targetMv / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
              const affordable = Math.floor(cash / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
              if (shares > affordable) shares = affordable;
              if (!Number.isFinite(shares) || shares < LOT_SIZE || shares * price < minMv) continue; // 顺延下一候选
              buy(code, shares, price, day, i, '调仓建仓');
            }

            // b3. 已持有且在目标的仓位调回目标市值（差额整手；减持部分同样整手，不足一手不动）
            for (const code of candidates) {
              const pos = positions.get(code);
              if (!pos) continue;
              if (pos.buyDayIdx >= i) continue; // T+1 保护
              const price = execPriceOf(code, day);
              if (price === undefined) continue;
              const diff = Math.floor(targetMv / price / LOT_SIZE) * LOT_SIZE - pos.shares;
              if (diff > 0) {
                let shares = Math.floor(diff / LOT_SIZE) * LOT_SIZE;
                const affordable = Math.floor(cash / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
                if (shares > affordable) shares = affordable;
                if (Number.isFinite(shares) && shares >= LOT_SIZE && shares * price >= minMv) buy(code, shares, price, day, i, '调仓补仓');
              } else if (diff < 0) {
                const shares = Math.floor(-diff / LOT_SIZE) * LOT_SIZE;
                if (Number.isFinite(shares) && shares >= LOT_SIZE) sell(pos, shares, price, day, '调仓减持');
              }
            }
          }
          pendingRebalance = null;
        }
      }

      // ── 结算阶段：权益 = 现金 + Σ(持仓 × 收盘)；停牌用最近有效收盘估值 ──
      let marketValue = 0;
      for (const pos of positions.values()) {
        const close = quoteOf(pos.code, day)?.close ?? lastClose.get(pos.code);
        if (close !== undefined) {
          lastClose.set(pos.code, close);
          pos.peakClose = Math.max(pos.peakClose, close);
          marketValue += pos.shares * close;
        } else {
          marketValue += pos.shares * (lastClose.get(pos.code) ?? pos.entryPrice);
        }
      }
      equities.push(cash + marketValue);
      turnoverByDay.push(dayTurnover);

      // ── 信号阶段（D 日收盘后）：卖出规则逐持仓检查 + 调仓日落目标持仓，指令 D+1 执行 ──
      if (p.sellRules.length && positions.size) {
        for (const pos of positions.values()) {
          if (pos.buyDayIdx >= i) continue; // T+1：当日买入的明日才可能触发卖出
          const close = quoteOf(pos.code, day)?.close ?? lastClose.get(pos.code);
          if (close === undefined) continue;
          const reason = this.matchSellRule(pos, close, i, day, p.sellRules, sellFieldSeries, staticSellRefs);
          if (reason) pendingSells.set(pos.code, reason);
        }
      }
      if (rebalanceIdxSet.has(i)) {
        pendingRebalance = signals.get(i) ?? null;
      }
    }

    const finalEquity = equities[equities.length - 1] ?? p.initialCapital;
    return { cash, positions, trades, equities, turnoverByDay, finalEquity, lastClose };
  }

  /** 卖出规则逐条检查（信号用当日收盘），返回第一条命中的原因描述 */
  private matchSellRule(
    pos: Position,
    close: number,
    dayIdx: DayIdx,
    day: number,
    rules: StrategySellRule[],
    sellFieldSeries: SellFieldData,
    staticSellRefs: Set<string>,
  ): string | null {
    for (const rule of rules) {
      switch (rule.kind) {
        case 'stop_profit':
          if (pos.entryPrice > 0 && close / pos.entryPrice - 1 >= rule.pct / 100) return `止盈+${rule.pct}%`;
          break;
        case 'stop_loss':
          if (pos.entryPrice > 0 && close / pos.entryPrice - 1 <= -rule.pct / 100) return `止损-${rule.pct}%`;
          break;
        case 'max_drawdown_from_entry':
          if (pos.peakClose > 0 && (pos.peakClose - close) / pos.peakClose >= rule.pct / 100) return `回撤止盈${rule.pct}%`;
          break;
        case 'max_hold_days':
          if (dayIdx - pos.buyDayIdx >= rule.days) return `持有满${rule.days}个交易日`;
          break;
        case 'field': {
          const key = `${rule.table}.${rule.field}`;
          const series = sellFieldSeries.get(key);
          const value = staticSellRefs.has(key)
            ? (series as Map<string, number>).get(pos.code)
            : (series as Map<string, Map<number, number>>).get(pos.code)?.get(day);
          if (value !== undefined && (rule.op === '>' ? value > rule.value : value < rule.value)) {
            return `${rule.field}${rule.op}${rule.value}触发`;
          }
          break;
        }
        case 'rank_out':
          break; // 仅调仓日在调仓信号中处理（排名跌出 → 调仓卖出）
      }
    }
    return null;
  }

  /** rank_out 判定：持仓股不在过滤后存活池（无排名）或排名跌出 bottomN 即命中 */
  private rankOutOf(code: string, compositeRank: Map<string, number>, bottomN: number): boolean {
    const rank = compositeRank.get(code);
    return rank === undefined || rank > bottomN;
  }

  /** field 类卖出规则的区间序列预取：带 TRADE_DATE 的表按日构建；静态表单值 */
  private async fetchSellFieldSeries(
    rules: Extract<StrategySellRule, { kind: 'field' }>[],
    codes: string[],
    p: NormalizedStrategyInput,
  ): Promise<SellFieldData> {
    const out: SellFieldData = new Map();
    for (const rule of rules) {
      const key = `${rule.table}.${rule.field}`;
      if (out.has(key)) continue;
      if (this.isDateTable(rule.table)) {
        const rows = await this.factorData.readFactorRange(rule.table, rule.field, codes, p.startDate, p.endDate);
        const byCode = new Map<string, Map<number, number>>();
        for (const row of rows) {
          let byDate = byCode.get(row.securityId);
          if (!byDate) {
            byDate = new Map<number, number>();
            byCode.set(row.securityId, byDate);
          }
          byDate.set(Number(row.tradeDate.replaceAll('-', '')), row.value);
        }
        out.set(key, byCode);
      } else {
        // 静态表（md_security 等主表）：值与日期无关，取单值
        const rows = await this.factorData.readFactorRange(rule.table, rule.field, codes, p.startDate, p.endDate);
        const byCode = new Map<string, number>();
        for (const row of rows) byCode.set(row.securityId, row.value);
        out.set(key, byCode);
      }
    }
    return out;
  }

  /** 表是否有 TRADE_DATE 列（决定卖出规则 field 序列按日还是单值） */
  private isDateTable(table: string): boolean {
    return loadTableFields(table)?.has('TRADE_DATE') ?? false;
  }

  /* ----- 卡片与摘要 ----- */

  private buildCard(
    p: NormalizedStrategyInput,
    agg: StrategyAggregate,
    loop: ReturnType<StrategyBacktestServiceImpl['runMainLoop']>,
    tradeDates: number[],
    coverage: { min: number; max: number },
    bench: { ticker: string; name: string },
    sortFactors: { factors: StrategySortFactor[]; usedDefault: boolean },
    rebalanceCount: number,
  ) {
    const feePct = (p.feeRate * 100).toFixed(2);
    const sortExpr = sortFactors.factors
      .map((f) => `${f.field}${f.direction === -1 ? '(小值优)' : ''}${f.weight !== undefined ? `×${f.weight}` : ''}`)
      .join(' + ');
    const totalFee = loop.trades.reduce((a, t) => a + t.fee, 0);
    return {
      type: 'backtest' as const,
      title: `${sortExpr} 策略回测`,
      tag: `策略回测·每${p.rebalanceIntervalDays}个交易日`,
      note:
        `日频事件内核：T 日收盘出信号 T+1 执行（${p.executionTiming === 0 ? '开盘价' : '收盘价'}成交），T+1/整手/停牌顺延，` +
        `触及涨跌停顺延（±10% 简化口径） ｜ 区间 ${p.startDate}~${p.endDate} ｜ ` +
        `单边费率 ${feePct}% 双边计提 ｜ 排序因子${sortFactors.usedDefault ? '缺省，默认 ' : '：'}${sortExpr}` +
        `${sortFactors.usedDefault ? '（值大优）' : ''}`,
      curve: agg.curve,
      benchCurve: agg.benchCurve,
      benchName: bench.name,
      metrics: toStrategyMetricItems(agg),
      // 本次回测真实参数（前端"回测参数"块按行渲染）
      params: [
        {
          label: '回测区间',
          value: `${toDashDate(Number(p.startDate))} ~ ${toDashDate(Number(p.endDate))}`,
          hint: `实际回测起止（数据表可用区间 ${coverage.min}~${coverage.max}）`,
        },
        {
          label: '股票池',
          value: p.securityIds ? `${p.securityIds.length} 只` : '全市场',
          hint: p.securityIds ? '前置筛选产出的证券清单，回测仅在池内选股' : '未限定股票池，全部调仓日在全市场过滤排序选股',
        },
        {
          label: '调仓间隔',
          value: `每 ${p.rebalanceIntervalDays} 个交易日 · ${rebalanceCount} 次调仓`,
          hint: 'T 日收盘出信号，T+1 执行；无未来函数',
        },
        {
          label: '每期持仓',
          value: `≤${p.maxPositions} 只 · 每只 ${p.idealPositionPct}%`,
          hint: `综合分降序取前 ${p.maxPositions} 只；最小建仓仓位 ${p.minPositionPct}%，低于则顺延下一候选`,
        },
        {
          label: '排序因子',
          value: describeSortFactors(sortFactors.factors),
          hint: sortFactors.usedDefault
            ? 'sortFactors 未传，引擎兜底追加默认 20 日动量（REVS20，值大优）'
            : '各因子截面分位数标准化（0~100）后加权合成综合分（weight 缺省等权 1/N）',
        },
        {
          label: '过滤因子',
          value: describeFilters(p.entryFilters),
          hint: '全部满足才入选；因子值缺失视为不满足',
        },
        {
          label: '卖出规则',
          value: describeSellRules(p.sellRules),
          hint: '持仓期每日收盘后检查，命中次日执行；rank_out 在调仓日按综合分排名生效',
        },
        {
          label: '初始资金/费用',
          value: `${(p.initialCapital / 10000).toFixed(0)} 万 · 单边 ${feePct}%`,
          hint: `整手（100 股）买卖；已计交易费用 ${totalFee.toFixed(0)} 元；空闲资金留存现金`,
        },
        {
          label: '业绩基准',
          value: bench.name,
          hint: `指数日收盘对齐组合交易日（数据表 mkt_idxd）`,
        },
      ],
      // 可复现配置：前端"保存为我的策略"（API-27）按它请求服务端重跑；结构即 StrategySpec v1
      config: {
        strategyType: p.strategyType,
        securityIds: p.securityIds,
        startDate: p.startDate,
        endDate: p.endDate,
        initialCapital: p.initialCapital,
        feeRate: p.feeRate,
        rebalanceIntervalDays: p.rebalanceIntervalDays,
        executionTiming: p.executionTiming,
        maxPositions: p.maxPositions,
        idealPositionPct: p.idealPositionPct,
        minPositionPct: p.minPositionPct,
        entryFilters: p.entryFilters,
        sortFactors: p.sortFactors,
        sellRules: p.sellRules,
        benchmark: p.benchmark,
      },
      // 逐点交易日（YYYYMMDD）：前端 x 轴按真实日期打刻度
      dates: tradeDates,
      // 交易明细（卡片截最近 50 笔；全量见 summary 统计）
      trades: loop.trades.slice(-50),
      // 月度归因
      monthly: agg.monthlyReturns,
    };
  }

  private buildSummary(
    p: NormalizedStrategyInput,
    agg: StrategyAggregate,
    loop: ReturnType<StrategyBacktestServiceImpl['runMainLoop']>,
    bench: { ticker: string; name: string },
    rebalanceCount: number,
    sortFactors: { factors: StrategySortFactor[]; usedDefault: boolean },
  ) {
    const buys = loop.trades.filter((t) => t.direction === 'buy');
    const sells = loop.trades.filter((t) => t.direction === 'sell');
    const totalFee = loop.trades.reduce((a, t) => a + t.fee, 0);
    const finalPositions = [...loop.positions.values()].map((pos) => {
      const close = loop.lastClose.get(pos.code);
      return {
        代码: pos.code,
        股数: pos.shares,
        成本价: +pos.entryPrice.toFixed(3),
        现价: close !== undefined ? +close.toFixed(3) : null,
        市值: +(pos.shares * (close ?? pos.entryPrice)).toFixed(0),
      };
    }).sort((a, b) => b.市值 - a.市值);
    return {
      ok: true,
      策略类型: p.strategyType,
      股票池: p.securityIds ? `${p.securityIds.length} 只` : '全市场',
      区间: `${p.startDate}~${p.endDate}`,
      调仓间隔: `每${p.rebalanceIntervalDays}个交易日（${rebalanceCount} 次调仓）`,
      排序因子: describeSortFactors(sortFactors.factors) + (sortFactors.usedDefault ? '【sortFactors 缺省，引擎默认追加】' : ''),
      过滤因子: describeFilters(p.entryFilters),
      卖出规则: describeSellRules(p.sellRules),
      成交时点: p.executionTiming === 0 ? '开盘价' : '收盘价',
      初始资金: p.initialCapital,
      期末权益: +loop.finalEquity.toFixed(0),
      期末现金: +loop.cash.toFixed(0),
      年化收益: formatPct(agg.metrics.annual),
      最大回撤: agg.metrics.drawdown.toFixed(1) + '%',
      夏普比率: agg.metrics.sharpe.toFixed(2),
      胜率: agg.metrics.winRate.toFixed(1) + '%',
      年化换手单边: formatPct(agg.annualTurnoverPct, 0),
      交易笔数: `买 ${buys.length} / 卖 ${sells.length}`,
      总费用: totalFee.toFixed(0) + ' 元',
      基准: `${bench.name} 年化 ${formatPct(agg.benchAnnual)}，超额 ${formatPct(agg.metrics.annual - agg.benchAnnual)}`,
      期末持仓: finalPositions.slice(0, 5),
      月度收益: agg.monthlyReturns.map((m) => `${m.month}:${formatPct(m.pct)}`).join(' '),
      提示: '回测卡片已生成并将随回复展示；请用不超过 90 字总结以上结果，只能引用返回数字，不要编造，结尾用短句提醒不构成投资建议。',
    };
  }

  /** 字典白名单：每个引用的表必须在 SQL/tables.md，字段必须在该表 SQL/<表名>.md */
  private assertWhitelist(refs: FactorRef[]): void {
    for (const ref of refs) {
      const fields = loadTableFields(ref.table);
      if (fields === undefined) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `表不在字段字典中（SQL/tables.md）: ${ref.table}。可用表: ${listKnownTables().join(', ') || '（无）'}`,
        );
      }
      if (!fields.has(ref.field)) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `表 ${ref.table} 无此因子字段（见 SQL/${ref.table}.md）: ${ref.field}`,
        );
      }
    }
  }
}
