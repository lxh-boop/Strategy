import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import {
  aggregateNav,
  annualizeTurnover,
  applyEntryFilters,
  BENCHMARKS,
  describeFilters,
  describeSellRules,
  describeSortFactors,
  effectiveSortFactors,
  formatPct,
  LIMIT_DOWN_RATIO,
  LIMIT_UP_RATIO,
  LOT_SIZE,
  NormalizedStrategyInput,
  rankUniverse,
  StrategyBacktestOutput,
  StrategySellRule,
  StrategySortFactor,
  StrategyTrade,
  toDashDate,
  toStrategyMetricItems,
} from '../strategy-backtest.service';
import { FactorDataService } from '../factor-data.service';
import { TriggerBacktestService } from '../trigger-backtest.service';
import { loadTableFields, listKnownTables } from '../factor-schema';
import {
  describeTimingOverlay,
  exposureOfRegime,
  holdingDaysPct,
  missedRallies,
  nextTimingRegime,
  positionDistribution,
  voteTiming,
  type StrategyTimingOverlay,
  type TimingRegime,
} from '../timing';
import { AgentProgressSink } from '../../types';
import { TRIGGER_UNIVERSE_MAX, MAX_DAILY_BUYS, MAX_TRADES, MAX_TOTAL_TURNOVER_PCT } from '../trigger-backtest.service';

/* ==========================================================
   模型 Ⅱ 条件触发引擎（独立实现，单遍逐日评估）：
   - 触发域必须预声明（securityIds，≤3000）；entryFilters ≥1 条（无条件 = 全域逐日触发不可控）；
   - 逐日信号：触发域截面判 entryFilters（满足 = 触发，按综合分排序定买入顺序）+ sellRules 逐持仓
     （v1 支持 stop_profit/stop_loss/max_drawdown_from_entry/max_hold_days，field/rank_out 不支持）；
   - 仓位偏离带：目标总仓位 = min(100, maxPositions×idealPositionPct) × 择时暴露%；
     偏离超 positionDeviatePct% 才再平衡（加仓按市值占比、现金封顶；减仓优先卖未 T+1 锁定仓）；
   - 数据：逐日截面（触发域）+ 触发后懒加载个股全区间行情（内存只随触发过的股票增长）；
   - 护栏：触发域 ≤3000、单日买入 ≤20 笔、累计交易 ≤20000 笔、累计换手 ≤MAX_TOTAL_TURNOVER_PCT。
   ========================================================== */

interface Quote {
  open: number | null;
  close: number;
  preClose: number;
}

interface Position {
  code: string;
  shares: number;
  entryPrice: number;
  buyDayIdx: number;
  peakClose: number;
}

@Injectable()
export class TriggerBacktestServiceImpl extends TriggerBacktestService {
  private readonly logger = new Logger('TriggerBacktest');

  constructor(private readonly factorData: FactorDataService) {
    super();
  }

  async run(p: NormalizedStrategyInput, onProgress?: AgentProgressSink): Promise<StrategyBacktestOutput> {
    // 触发域：必须预声明（全市场逐日评估成本不可控）
    if (!p.securityIds?.length) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        '触发模式必须预声明触发域 securityIds（候选监视名单，上限 3000 只）——全市场逐日评估成本不可控。' +
          '可先用筛选条件缩小范围（如某行业/某板块），或改用定期调仓模式（模型 Ⅰ）',
      );
    }
    if (p.securityIds.length > TRIGGER_UNIVERSE_MAX) {
      throw new ApiException('INVALID_ARGUMENT', 400, `触发域过大（${p.securityIds.length} 只，上限 ${TRIGGER_UNIVERSE_MAX}）：请先用筛选条件收敛股票池`);
    }
    if (!p.entryFilters.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, '触发模式必须至少一条买入触发条件（entryFilters）——无条件会让触发域内全部股票逐日触发买入');
    }
    const unsupported = p.sellRules.filter((r) => r.kind === 'field' || r.kind === 'rank_out');
    if (unsupported.length) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        '触发模式 v1 的卖出规则不支持 field（字段条件）与 rank_out（排名跌出）——请使用止盈/止损/回撤止盈/持有天数',
      );
    }
    const sortFactors = effectiveSortFactors(p.sortFactors);
    const sortUsed = sortFactors.factors.map((f) => `${f.table}.${f.field}`);

    // 白名单：触发条件 + 排序因子 + 择时引用
    const refs = [
      ...p.entryFilters.map((f) => ({ table: f.table, field: f.field })),
      ...sortUsed.map((k) => ({ table: k.split('.')[0], field: k.split('.')[1] })),
      ...(p.timingOverlay ? this.collectTimingRefsOf(p.timingOverlay) : []),
    ];
    this.assertWhitelist(refs);

    // ① 日历（首个引用表；纯择时+无 entryFilters 已被上面拦截，entryRefs 必非空）
    const coverage = await this.factorData.readTradeDates(refs[0].table, p.startDate, p.endDate);
    if (Number(p.startDate) < coverage.min || Number(p.endDate) > coverage.max) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `回测区间超出数据范围：${refs[0].table} 可用区间 ${coverage.min}~${coverage.max}，请调整 startDate/endDate`,
      );
    }
    const tradeDates = coverage.dates;
    if (tradeDates.length < 2) {
      throw new ApiException('INVALID_ARGUMENT', 400, `区间 ${p.startDate}~${p.endDate} 内交易日不足（${tradeDates.length} 天），无法回测`);
    }

    // ② 基准
    const bench = BENCHMARKS[p.benchmark];
    const indexRows = await this.factorData.readIndexDaily('mkt_idxd', bench.ticker, p.startDate, p.endDate);
    const indexByDate = new Map(indexRows.map((r) => [r.tradeDate, r]));
    const benchReturns = tradeDates.map((day) => {
      const row = indexByDate.get(toDashDate(day));
      return row && row.preClose > 0 ? row.close / row.preClose - 1 : 0;
    });

    // ③ 择时序列（共享构件，逐日状态机）
    const timing = p.timingOverlay ?? null;
    const exposureByDay: number[] = [];
    if (timing) {
      const ticker = BENCHMARKS[timing.index].ticker;
      const seriesByKey = new Map<string, Map<number, number>>();
      for (const rule of timing.rules) {
        const key = `${rule.table}.${rule.field}`;
        if (seriesByKey.has(key)) continue;
        const rows = await this.factorData.readIndexFieldSeries(rule.table, rule.field, ticker, p.startDate, p.endDate);
        const byDay = new Map<number, number>();
        for (const row of rows) byDay.set(Number(row.tradeDate.replaceAll('-', '')), row.value);
        seriesByKey.set(key, byDay);
      }
      let regime: TimingRegime = 'bull';
      for (let i = 0; i < tradeDates.length; i++) {
        const day = tradeDates[i];
        exposureByDay.push(exposureOfRegime(regime, timing));
        const values = timing.rules.map((r) => seriesByKey.get(`${r.table}.${r.field}`)?.get(day));
        regime = nextTimingRegime(regime, voteTiming(timing, values), timing);
      }
    } else {
      exposureByDay.push(...tradeDates.map(() => 100));
    }

    // ④ 主循环（单遍逐日：执行 → 结算 → 信号），行情懒加载、截面逐日取
    const loop = await this.runMainLoop(p, tradeDates, sortFactors.factors, benchReturns, exposureByDay, onProgress);

    // ⑤ 聚合 → 卡片 + 摘要
    const aggregate = aggregateNav(loop.equities, benchReturns, tradeDates);
    aggregate.annualTurnoverPct = annualizeTurnover(loop.turnoverByDay, loop.equities);
    aggregate.metrics.turnover = aggregate.annualTurnoverPct;
    const timingStats = timing
      ? {
          positionDist: positionDistribution(exposureByDay),
          holdingDaysPct: holdingDaysPct(exposureByDay),
          missedRallies: missedRallies(benchReturns, tradeDates, exposureByDay),
        }
      : null;
    const card = this.buildCard(p, aggregate, loop, tradeDates, bench, sortFactors.factors, timingStats);
    const summary = this.buildSummary(p, aggregate, loop, bench, sortFactors.factors, timing, timingStats);
    this.logger.log(
      `触发回测 ${p.startDate}~${p.endDate} 偏离带${p.positionDeviatePct}%: 年化=${summary.年化收益} 回撤=${summary.最大回撤} 交易 ${loop.trades.length} 笔`,
    );
    return { card, summary, metrics: aggregate.metrics };
  }

  /* ----- 主循环 ----- */

  private async runMainLoop(
    p: NormalizedStrategyInput,
    tradeDates: number[],
    sortFactors: StrategySortFactor[],
    benchReturns: number[],
    exposureByDay: number[],
    onProgress?: AgentProgressSink,
  ) {
    const entryRefs = [...new Set(p.entryFilters.map((f) => `${f.table}.${f.field}`))];
    const totalTargetPct = Math.min(100, p.maxPositions * p.idealPositionPct);
    const band = p.positionDeviatePct ?? 20;

    let cash = p.initialCapital;
    const positions = new Map<string, Position>();
    const trades: StrategyTrade[] = [];
    const equities: number[] = [];
    const turnoverByDay: number[] = [];
    const lastClose = new Map<string, number>();
    let pendingSells = new Map<string, string>();
    let pendingBuys: string[] = [];
    let dayTurnover = 0;

    /** 触发后懒加载个股全区间行情（内存只随触发过的股票增长） */
    const quotesByCode = new Map<string, Map<number, Quote>>();
    const quoteLoaded = new Set<string>();
    const loadQuotes = async (codes: string[]) => {
      const todo = [...new Set(codes)].filter((c) => !quoteLoaded.has(c));
      if (!todo.length) return;
      for (const c of todo) quoteLoaded.add(c);
      const rows = await this.factorData.readQuoteSeries(todo, p.startDate, p.endDate);
      for (const row of rows) {
        if (!(row.close > 0) || !(row.preClose > 0)) continue;
        const code = `${row.ticker}.${row.exchange}`;
        let byDate = quotesByCode.get(code);
        if (!byDate) {
          byDate = new Map<number, Quote>();
          quotesByCode.set(code, byDate);
        }
        byDate.set(Number(row.tradeDate.replaceAll('-', '')), {
          open: row.open !== null && row.open > 0 ? row.open : null,
          close: row.close,
          preClose: row.preClose,
        });
      }
    };

    const quoteOf = (code: string, day: number): Quote | undefined => quotesByCode.get(code)?.get(day);
    const execPriceOf = (code: string, day: number): number | undefined => {
      const q = quoteOf(code, day);
      if (!q) return undefined;
      return p.executionTiming === 0 ? (q.open ?? undefined) : q.close;
    };

    const buy = (code: string, shares: number, price: number, day: number, dayIdx: number, reason: string) => {
      const amount = shares * price;
      const fee = amount * p.feeRate;
      cash -= amount + fee;
      dayTurnover += amount;
      const pos = positions.get(code);
      if (pos) {
        pos.entryPrice = (pos.entryPrice * pos.shares + price * shares) / (pos.shares + shares);
        pos.shares += shares;
        pos.buyDayIdx = dayIdx;
        pos.peakClose = Math.max(pos.peakClose, price);
      } else {
        positions.set(code, { code, shares, entryPrice: price, buyDayIdx: dayIdx, peakClose: price });
      }
      trades.push({ date: day, code, direction: 'buy', price, shares, amount, fee, reason });
      if (trades.length > MAX_TRADES) {
        throw new ApiException('INVALID_ARGUMENT', 400, `交易笔数过多（超 ${MAX_TRADES} 笔）：请放宽触发条件、加大偏离带宽或缩短区间`);
      }
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

    const regimeAt = (i: number): number => exposureByDay[i] ?? 100;

    for (let i = 0; i < tradeDates.length; i++) {
      const day = tradeDates[i];
      dayTurnover = 0;
      const exposure = regimeAt(i);

      // ── 执行阶段 ──
      if (i > 0) {
        // a. 卖出指令（T+1/停牌/跌停顺延）
        for (const [code, reason] of pendingSells) {
          const pos = positions.get(code);
          if (!pos) continue;
          if (pos.buyDayIdx >= i) continue;
          const price = execPriceOf(code, day);
          const q = quoteOf(code, day);
          if (price === undefined || !q) continue;
          if (price <= q.preClose * LIMIT_DOWN_RATIO) continue;
          sell(pos, pos.shares, price, day, reason);
        }
        pendingSells = new Map();

        // b. 触发买入（按昨日综合分序；持仓数上限 + 单日买入笔数上限 + 现金缩股）
        const equity0 = cash + [...positions.values()].reduce((a, pos) => {
          const px = execPriceOf(pos.code, day) ?? lastClose.get(pos.code) ?? pos.entryPrice;
          return a + pos.shares * px;
        }, 0);
        const targetMv = (equity0 * p.idealPositionPct) / 100 * (exposure / 100);
        let buysToday = 0;
        for (const code of pendingBuys) {
          if (buysToday >= MAX_DAILY_BUYS) break;
          if (positions.size >= p.maxPositions) break;
          if (positions.has(code)) continue;
          const price = execPriceOf(code, day);
          const q = quoteOf(code, day);
          if (price === undefined || !q) continue; // 停牌
          if (price >= q.preClose * LIMIT_UP_RATIO) continue; // 涨停
          let shares = Math.floor(targetMv / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
          const affordable = Math.floor(cash / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
          if (shares > affordable) shares = affordable;
          if (!Number.isFinite(shares) || shares < LOT_SIZE) continue;
          buy(code, shares, price, day, i, '触发建仓');
          buysToday++;
        }
        pendingBuys = [];

        // c. 仓位偏离带再平衡：总仓位偏离目标超带宽才动作（择时目标仓位即目标总仓位）
        {
          const targetRatioPct = totalTargetPct * (exposure / 100);
          const equityNow = cash + [...positions.values()].reduce((a, pos) => {
            const px = execPriceOf(pos.code, day) ?? lastClose.get(pos.code) ?? pos.entryPrice;
            return a + pos.shares * px;
          }, 0);
          const invested = equityNow - cash;
          const ratioPct = equityNow > 0 ? (invested / equityNow) * 100 : 0;
          if (equityNow > 0 && Math.abs(ratioPct - targetRatioPct) > band) {
            const targetMvAll = (equityNow * targetRatioPct) / 100;
            if (targetMvAll < invested) {
              const need = invested - targetMvAll;
              const unlocked = [...positions.values()].filter((pos) => pos.buyDayIdx < i);
              const unlockMv = unlocked.reduce((a, pos) => {
                const px = execPriceOf(pos.code, day);
                return a + (px !== undefined ? pos.shares * px : 0);
              }, 0);
              for (const pos of unlocked) {
                const price = execPriceOf(pos.code, day);
                const q = quoteOf(pos.code, day);
                if (price === undefined || !q) continue;
                if (price <= q.preClose * LIMIT_DOWN_RATIO) continue;
                const mv = pos.shares * price;
                let shares = Math.floor(((mv / (unlockMv || 1)) * need) / price / LOT_SIZE) * LOT_SIZE;
                if (shares > pos.shares) shares = pos.shares;
                shares = Math.floor(shares / LOT_SIZE) * LOT_SIZE;
                if (shares < LOT_SIZE) continue;
                sell(pos, shares, price, day, '偏离带减仓');
              }
            } else if (cash > 0 && invested > 0) {
              const add = Math.min(targetMvAll - invested, cash / (1 + p.feeRate));
              for (const pos of [...positions.values()]) {
                const price = execPriceOf(pos.code, day);
                const q = quoteOf(pos.code, day);
                if (price === undefined || !q) continue;
                if (price >= q.preClose * LIMIT_UP_RATIO) continue;
                const mv = pos.shares * price;
                let shares = Math.floor(((mv / invested) * add) / price / LOT_SIZE) * LOT_SIZE;
                const affordable = Math.floor(cash / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
                if (shares > affordable) shares = affordable;
                if (Number.isFinite(shares) && shares >= LOT_SIZE) buy(pos.code, shares, price, day, i, '偏离带加仓');
              }
            }
          }
        }
      }

      // ── 结算阶段 ──
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

      // 换手失控保护（累计单边成交 / 初始资金）
      const totalTurnover = turnoverByDay.reduce((a, t) => a + t, 0);
      if (totalTurnover > (MAX_TOTAL_TURNOVER_PCT / 100) * p.initialCapital) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `累计换手过大（超初始资金 ${MAX_TOTAL_TURNOVER_PCT / 100} 倍）：请放宽触发条件、加大偏离带宽或缩短区间`,
        );
      }

      // ── 信号阶段（D 日收盘后，D+1 执行）──
      if (p.sellRules.length && positions.size) {
        for (const pos of positions.values()) {
          if (pos.buyDayIdx >= i) continue;
          const close = quoteOf(pos.code, day)?.close ?? lastClose.get(pos.code);
          if (close === undefined) continue;
          const reason = this.matchSellRule(pos, close, i, p.sellRules);
          if (reason) pendingSells.set(pos.code, reason);
        }
      }
      // 触发评估（末日信号无次日执行，跳过评估省一次截面查询）
      if (i < tradeDates.length - 1) {
        const date = String(day);
        const sections = await Promise.all(
          entryRefs.map((key) => {
            const [table, field] = key.split('.');
            return this.factorData.readFactorSection(table, field, date, p.securityIds);
          }),
        );
        const sectionMaps = entryRefs.map((key, idx) => new Map(sections[idx].map((r) => [r.securityId, r.value])));
        const pool = applyEntryFilters(p.securityIds ?? [], p.entryFilters, sectionMaps);
        const ranked = rankUniverse(sortFactors, sectionMaps, pool);
        const triggered = ranked.map((r) => r.code);
        if (triggered.length) {
          await loadQuotes(triggered); // 触发即装载该股行情（执行/结算需要）
          pendingBuys.push(...triggered);
        }
        onProgress?.({
          type: 'tool_call',
          name: 'run_strategy_backtest',
          stage: '逐日触发评估',
          args: `${String(day)} · 触发 ${triggered.length} 只`,
        });
      }
    }

    const finalEquity = equities[equities.length - 1] ?? p.initialCapital;
    return { cash, positions, trades, equities, turnoverByDay, finalEquity, lastClose };
  }

  /** 触发模式的卖出规则检查：仅止盈/止损/回撤止盈/持有天数（field/rank_out 已在校验层拒绝） */
  private matchSellRule(pos: Position, close: number, dayIdx: number, rules: StrategySellRule[]): string | null {
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
        default:
          break;
      }
    }
    return null;
  }

  private collectTimingRefsOf(overlay: StrategyTimingOverlay) {
    return overlay.rules.map((r) => ({ table: r.table, field: r.field }));
  }

  /** 字典白名单（与模型 Ⅰ 同口径） */
  private assertWhitelist(refs: { table: string; field: string }[]): void {
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
        throw new ApiException('INVALID_ARGUMENT', 400, `表 ${ref.table} 无此因子字段（见 SQL/${ref.table}.md）: ${ref.field}`);
      }
    }
  }

  /* ----- 卡片与摘要 ----- */

  private buildCard(
    p: NormalizedStrategyInput,
    agg: ReturnType<typeof aggregateNav>,
    loop: Awaited<ReturnType<TriggerBacktestServiceImpl['runMainLoop']>>,
    tradeDates: number[],
    bench: { ticker: string; name: string },
    sortFactors: StrategySortFactor[],
    timingStats: { positionDist: { label: string; days: number }[]; holdingDaysPct: number; missedRallies: { date: number; pct: number; exposure: number }[] } | null,
  ) {
    const timing = p.timingOverlay ?? null;
    const feePct = (p.feeRate * 100).toFixed(2);
    const sortExpr = sortFactors.map((f) => `${f.field}${f.direction === -1 ? '(小值优)' : ''}`).join(' + ');
    const totalFee = loop.trades.reduce((a, t) => a + t.fee, 0);
    return {
      type: 'backtest' as const,
      title: `${sortExpr} 条件触发回测`,
      tag: `条件触发·偏离带 ${p.positionDeviatePct}%`,
      note:
        `模型 Ⅱ 触发引擎：entryFilters 逐日评估，满足即次日买入（${p.executionTiming === 0 ? '开盘价' : '收盘价'}成交）；` +
        `持仓市值偏离目标总仓位 ±${p.positionDeviatePct}% 触发再平衡 ｜ 区间 ${p.startDate}~${p.endDate} ｜ 单边费率 ${feePct}%`,
      curve: agg.curve,
      benchCurve: agg.benchCurve,
      benchName: bench.name,
      metrics: toStrategyMetricItems(agg),
      params: [
        { label: '回测区间', value: `${toDashDate(Number(p.startDate))} ~ ${toDashDate(Number(p.endDate))}` },
        { label: '触发域', value: `${p.securityIds?.length ?? 0} 只`, hint: '预声明的逐日监视名单（securityIds）' },
        { label: '触发条件', value: describeFilters(p.entryFilters), hint: '逐日评估，全部满足即触发；按综合分排序定买入顺序' },
        { label: '仓位偏离带', value: `±${p.positionDeviatePct}%`, hint: `目标总仓位 ${Math.min(100, p.maxPositions * p.idealPositionPct)}%，偏离超带宽即再平衡` },
        { label: '持仓上限', value: `≤${p.maxPositions} 只 · 每只 ${p.idealPositionPct}%`, hint: '单日买入笔数与总换手有护栏' },
        { label: '卖出规则', value: describeSellRules(p.sellRules), hint: '逐日收盘后检查，命中次日执行' },
        ...(timing
          ? [
              {
                label: '大盘择时',
                value: describeTimingOverlay(timing),
                hint: '字段条件逐日投票，状态机决定总仓位：牛市满仓、熊市保留仓位',
              },
            ]
          : []),
        { label: '初始资金/费用', value: `${(p.initialCapital / 10000).toFixed(0)} 万 · 单边 ${feePct}%`, hint: `已计交易费用 ${totalFee.toFixed(0)} 元` },
        { label: '业绩基准', value: bench.name },
      ],
      config: {
        strategyType: p.strategyType,
        securityIds: p.securityIds,
        startDate: p.startDate,
        endDate: p.endDate,
        initialCapital: p.initialCapital,
        feeRate: p.feeRate,
        rebalanceIntervalDays: p.rebalanceIntervalDays,
        positionDeviatePct: p.positionDeviatePct,
        executionTiming: p.executionTiming,
        maxPositions: p.maxPositions,
        idealPositionPct: p.idealPositionPct,
        minPositionPct: p.minPositionPct,
        entryFilters: p.entryFilters,
        sortFactors: p.sortFactors,
        sellRules: p.sellRules,
        benchmark: p.benchmark,
        ...(timing ? { timingOverlay: timing } : {}),
      },
      dates: tradeDates,
      trades: loop.trades.slice(-50),
      monthly: agg.monthlyReturns,
      ...(timingStats
        ? {
            positionDist: timingStats.positionDist,
            holdingDaysPct: timingStats.holdingDaysPct,
            missedRallies: timingStats.missedRallies,
          }
        : {}),
    };
  }

  private buildSummary(
    p: NormalizedStrategyInput,
    agg: ReturnType<typeof aggregateNav>,
    loop: Awaited<ReturnType<TriggerBacktestServiceImpl['runMainLoop']>>,
    bench: { ticker: string; name: string },
    sortFactors: StrategySortFactor[],
    timing: StrategyTimingOverlay | null,
    timingStats: { positionDist: { label: string; days: number }[]; holdingDaysPct: number; missedRallies: { date: number; pct: number; exposure: number }[] } | null,
  ) {
    const buys = loop.trades.filter((t) => t.direction === 'buy');
    const sells = loop.trades.filter((t) => t.direction === 'sell');
    const totalFee = loop.trades.reduce((a, t) => a + t.fee, 0);
    return {
      ok: true,
      策略类型: '条件触发（模型 Ⅱ）',
      触发域: `${p.securityIds?.length ?? 0} 只`,
      触发条件: describeFilters(p.entryFilters),
      排序因子: describeSortFactors(sortFactors),
      偏离带宽: `±${p.positionDeviatePct}%`,
      区间: `${p.startDate}~${p.endDate}`,
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
      ...(timingStats
        ? {
            择时规则: timing ? describeTimingOverlay(timing) : '',
            仓位分布: timingStats.positionDist.map((b) => `${b.label}:${b.days}日`).join(' '),
            持股时间占比: `${timingStats.holdingDaysPct}%`,
            踏空归因: timingStats.missedRallies.map((m) => `${m.date} 基准${formatPct(m.pct)}(仓位${m.exposure}%)`).join(' ') || '无',
          }
        : {}),
      提示: '回测卡片已生成并将随回复展示；请用不超过 90 字总结以上结果，只能引用返回数字，不要编造，结尾用短句提醒不构成投资建议。',
    };
  }
}
