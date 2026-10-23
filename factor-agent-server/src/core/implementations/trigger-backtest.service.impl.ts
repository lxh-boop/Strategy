import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import {
  aggregateNav,
  aggregatePeriodRows,
  annualizeTurnover,
  applyEntryFilters,
  BENCHMARKS,
  buildPeriodHoldings,
  describeFilters,
  describeKeepRules,
  describeSellRules,
  describeSortFactors,
  effectiveSortFactors,
  formatPct,
  INDEX_VALUE_KEY,
  indexFilterCode,
  isIndexFilterRule,
  LOT_SIZE,
  NormalizedStrategyInput,
  rankUniverse,
  StrategyBacktestOutput,
  StrategyFilterRule,
  StrategyKeepRule,
  StrategySortFactor,
  toDashDate,
  toStrategyMetricItems,
} from '../strategy-backtest.service';
import { FactorDataService } from '../factor-data.service';
import { TriggerBacktestService } from '../trigger-backtest.service';
import { assertWhitelist, loadTableFields } from '../factor-schema';
import {
  collectTimingRefs,
  describeTimingOverlay,
  holdingDaysPct,
  missedRallies,
  positionDistribution,
  precomputeExposureSeries,
  type StrategyTimingOverlay,
} from '../timing';
import { Account, matchKeepRule, matchSellRule, type Position, type Quote, type SellFieldData } from '../account';
import { AgentProgressSink, BacktestCard } from '../../types';
import { TRIGGER_UNIVERSE_MAX, MAX_DAILY_BUYS, MAX_TRADES, MAX_TOTAL_TURNOVER_PCT } from '../trigger-backtest.service';

/** 触发模式不支持 field 卖出规则（校验层已拒），共享卖出判定传入空预取结构 */
const NO_SELL_FIELD_SERIES: SellFieldData = new Map();
const NO_STATIC_SELL_REFS = new Set<string>();

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
    // 排除时间段第一批只做日历引擎（模型 Ⅰ）；触发引擎显式拒绝，不做静默忽略
    if (p.excludeRanges.length) {
      throw new ApiException('INVALID_ARGUMENT', 400, '触发模式暂不支持排除时间段（excludeRanges）——请去掉该参数或改用定期调仓模式');
    }
    const sortFactors = effectiveSortFactors(p.sortFactors);
    const sortUsed = sortFactors.factors.map((f) => `${f.table}.${f.field}`);

    // 白名单：触发条件（大盘条件除外，走指数通道）+ 排序因子 + 不卖条件 + 择时引用
    const refs = [
      ...p.entryFilters.filter((f) => !isIndexFilterRule(f)).map((f) => ({ table: f.table, field: f.field })),
      ...p.entryFilters.filter(isIndexFilterRule).map((f) => ({ table: f.table, field: f.field })),
      ...sortUsed.map((k) => ({ table: k.split('.')[0], field: k.split('.')[1] })),
      ...p.keepRules.map((r) => ({ table: r.table, field: r.field })),
      ...(p.timingOverlay ? collectTimingRefs(p.timingOverlay) : []),
    ];
    assertWhitelist(refs);

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

    // ③ 择时序列（收拢于 timing.precomputeExposureSeries，逐日状态机）
    const timing = p.timingOverlay ?? null;
    let exposureByDay: number[];
    if (timing) {
      ({ exposureByDay } = await precomputeExposureSeries(
        timing,
        tradeDates,
        p.startDate,
        p.endDate,
        (table, field, ticker, start, end) => this.factorData.readIndexFieldSeries(table, field, ticker, start, end),
      ));
    } else {
      exposureByDay = tradeDates.map(() => 100);
    }

    // ③′ 大盘条件序列预载 + 不卖条件取数（与模型 Ⅰ 同通道：日期表按日、静态表单值）
    const indexSeriesByKey = new Map<string, Map<number, number>>();
    for (const rule of p.entryFilters.filter(isIndexFilterRule)) {
      const key = `${rule.table}.${rule.field}#${indexFilterCode(rule)}`;
      if (indexSeriesByKey.has(key)) continue;
      const rows = await this.factorData.readIndexFieldSeries(
        rule.table,
        rule.field,
        BENCHMARKS[indexFilterCode(rule)].ticker,
        p.startDate,
        p.endDate,
      );
      indexSeriesByKey.set(key, new Map(rows.map((r) => [Number(r.tradeDate.replaceAll('-', '')), r.value])));
    }
    const staticKeepRefs = new Set(
      p.keepRules.map((r) => `${r.table}.${r.field}`).filter((key) => !(loadTableFields(key.split('.')[0])?.has('TRADE_DATE') ?? false)),
    );
    const keepFieldSeries: SellFieldData = new Map();
    for (const rule of p.keepRules) {
      const key = `${rule.table}.${rule.field}`;
      if (keepFieldSeries.has(key)) continue;
      const rows = await this.factorData.readFactorRange(rule.table, rule.field, p.securityIds!, p.startDate, p.endDate);
      if (staticKeepRefs.has(key)) {
        const byCode = new Map<string, number>();
        for (const row of rows) byCode.set(row.securityId, row.value);
        keepFieldSeries.set(key, byCode);
      } else {
        const byCode = new Map<string, Map<number, number>>();
        for (const row of rows) {
          let byDate = byCode.get(row.securityId);
          if (!byDate) {
            byDate = new Map<number, number>();
            byCode.set(row.securityId, byDate);
          }
          byDate.set(Number(row.tradeDate.replaceAll('-', '')), row.value);
        }
        keepFieldSeries.set(key, byCode);
      }
    }

    // ④ 主循环（单遍逐日：执行 → 结算 → 信号），行情懒加载、截面逐日取
    const loop = await this.runMainLoop(p, tradeDates, sortFactors.factors, benchReturns, exposureByDay, indexSeriesByKey, keepFieldSeries, staticKeepRefs, onProgress);

    // ⑤ 聚合 → 卡片 + 摘要（按周切期：每 5 个交易日一期）
    const aggregate = aggregateNav(loop.equities, benchReturns, tradeDates);
    const periodRows = aggregatePeriodRows({
      tradeDates,
      equities: loop.equities,
      benchReturns,
      turnoverByDay: loop.turnoverByDay,
      trades: loop.trades,
      periodStarts: tradeDates.map((_, i) => i).filter((i) => i % 5 === 0),
      exposureByDay,
      initialCapital: p.initialCapital,
    });
    aggregate.annualTurnoverPct = annualizeTurnover(loop.turnoverByDay, loop.equities);
    aggregate.metrics.turnover = aggregate.annualTurnoverPct;
    const timingStats = timing
      ? {
          positionDist: positionDistribution(exposureByDay),
          holdingDaysPct: holdingDaysPct(exposureByDay),
          missedRallies: missedRallies(benchReturns, tradeDates, exposureByDay),
        }
      : null;
    const card = this.buildCard(p, aggregate, loop, tradeDates, bench, sortFactors.factors, periodRows, timingStats);
    card.periodHoldings = loop.periodHoldings;
    card.latestOrders = loop.latestOrders;
    card.recentSold = loop.recentSold;
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
    indexSeriesByKey: Map<string, Map<number, number>>,
    keepFieldSeries: SellFieldData,
    staticKeepRefs: Set<string>,
    onProgress?: AgentProgressSink,
  ) {
    const keepRules: StrategyKeepRule[] = p.keepRules;
    const factorRefs = [
      ...new Set([
        ...p.entryFilters.filter((f) => !isIndexFilterRule(f)).map((f) => `${f.table}.${f.field}`),
        ...sortFactors.map((f) => `${f.table}.${f.field}`),
      ]),
    ];
    const totalTargetPct = Math.min(100, p.maxPositions * p.idealPositionPct);
    const band = p.positionDeviatePct ?? 20;

    const account = new Account(p.initialCapital, {
      feeRate: p.feeRate,
      slippageRate: p.slippageRate,
      limitUpDownSkip: p.limitUpDownSkip,
      limitPricesOf: (code, day) => quotesByCode.get(code)?.get(day),
      tradeLimit: {
        max: MAX_TRADES,
        message: `交易笔数过多（超 ${MAX_TRADES} 笔）：请放宽触发条件、加大偏离带宽或缩短区间`,
      },
    });
    const equities: number[] = [];
    const turnoverByDay: number[] = [];
    let pendingSells = new Map<string, string>();
    let pendingBuys: string[] = [];

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
          limitUp: row.limitUp ?? null,
          limitDown: row.limitDown ?? null,
        });
      }
    };

    const quoteOf = (code: string, day: number): Quote | undefined => quotesByCode.get(code)?.get(day);
    const execPriceOf = (code: string, day: number): number | undefined => {
      const q = quoteOf(code, day);
      if (!q) return undefined;
      return p.executionTiming === 0 ? (q.open ?? undefined) : q.close;
    };

    for (let i = 0; i < tradeDates.length; i++) {
      const day = tradeDates[i];
      const exposure = exposureByDay[i] ?? 100;

      // ── 执行阶段 ──
      if (i > 0) {
        // a. 卖出指令（T+1/停牌顺延；跌停拒卖在闸内 ADR-0009）
        for (const [code, reason] of pendingSells) {
          const pos = account.positionOf(code);
          if (!pos) continue;
          if (pos.buyDayIdx >= i) continue;
          const price = execPriceOf(code, day);
          if (price === undefined) continue;
          account.sellAll(pos, price, day, reason);
        }
        pendingSells = new Map();

        // b. 触发买入（按昨日综合分序；持仓数上限 + 单日买入笔数上限 + 现金缩股 + 最小建仓仓位；
        //    涨停拒买在闸内 ADR-0009，闸拒单等效顺延下一候选）
        const equity0 = account.equity((code) => execPriceOf(code, day));
        const targetMv = (equity0 * p.idealPositionPct) / 100 * (exposure / 100);
        const minMv = (equity0 * p.minPositionPct) / 100;
        let buysToday = 0;
        for (const code of pendingBuys) {
          if (buysToday >= MAX_DAILY_BUYS) break;
          if (account.size() >= p.maxPositions) break;
          if (account.positionOf(code)) continue;
          const price = execPriceOf(code, day);
          if (price === undefined) continue; // 停牌
          let shares = Math.floor(targetMv / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
          const affordable = account.affordableShares(price);
          if (shares > affordable) shares = affordable;
          if (!Number.isFinite(shares) || shares < LOT_SIZE || shares * price < minMv) continue; // 低于最小建仓仓位顺延下一候选（与模型 Ⅰ 同口径）
          account.buy(code, shares, price, day, i, '触发建仓');
          buysToday++;
        }
        pendingBuys = [];

        // c. 仓位偏离带再平衡：总仓位偏离目标超带宽才动作（择时目标仓位即目标总仓位）；涨跌停闸内建
        account.rebalanceToTotal(
          totalTargetPct * (exposure / 100),
          band,
          day,
          i,
          { trim: '偏离带减仓', add: '偏离带加仓' },
          {
            priceOf: (code) => execPriceOf(code, day),
          },
        );
      }

      // ── 结算阶段 ──
      equities.push(account.settle((code) => quoteOf(code, day)?.close));
      turnoverByDay.push(account.takeDayTurnover());

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
      if (p.sellRules.length && account.size() > 0) {
        for (const pos of account.allPositions()) {
          if (pos.buyDayIdx >= i) continue;
          if (keepRules.length && matchKeepRule(pos, day, keepRules, keepFieldSeries, staticKeepRefs)) continue; // 不卖条件：跳过本轮卖出检查
          const close = quoteOf(pos.code, day)?.close ?? account.lastCloseOf(pos.code);
          if (close === undefined) continue;
          const reason = matchSellRule(pos, close, i, day, p.sellRules, NO_SELL_FIELD_SERIES, NO_STATIC_SELL_REFS);
          if (reason) pendingSells.set(pos.code, reason);
        }
      }
      // 触发评估（末日信号无次日执行，跳过评估省一次截面查询）
      if (i < tradeDates.length - 1) {
        const date = String(day);
        const sections = await Promise.all(
          factorRefs.map((key) => {
            const [table, field] = key.split('.');
            return this.factorData.readFactorSection(table, field, date, p.securityIds);
          }),
        );
        const byName = new Map<string, Map<string, number>>();
        factorRefs.forEach((key, idx) => {
          byName.set(key, new Map(sections[idx].map((r) => [r.securityId, r.value])));
        });
        // 过滤/排序按列名各取各的截面：截面清单是过滤∪排序的并集，按下标会错位；
        // 大盘条件从预载序列取当日值，以哨兵键广播成全池统一值（缺值弃权）
        const filterSections = p.entryFilters.map((f): Map<string, number> => {
          if (!isIndexFilterRule(f)) return byName.get(`${f.table}.${f.field}`)!;
          const v = indexSeriesByKey.get(`${f.table}.${f.field}#${indexFilterCode(f)}`)?.get(day);
          return new Map(v === undefined ? [] : [[INDEX_VALUE_KEY, v]]);
        });
        const rankSections = sortFactors.map((f) => byName.get(`${f.table}.${f.field}`)!);
        const pool = applyEntryFilters(p.securityIds ?? [], p.entryFilters, filterSections);
        const ranked = rankUniverse(sortFactors, rankSections, pool);
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
    // 每期持仓明细：重放交易流水（触发模式无调仓日，按 5 交易日切期，与历史持仓详情面板同口径）
    const periodAgg = buildPeriodHoldings(
      account.trades(),
      tradeDates,
      tradeDates.map((_, i) => i).filter((i) => i % 5 === 0),
      (code, day) => quoteOf(code, day)?.close ?? account.lastCloseOf(code),
    );
    return {
      cash: account.cash(),
      positions: account.positionsMap(),
      trades: account.trades(),
      equities,
      turnoverByDay,
      finalEquity,
      lastClose: account.lastCloseMap(),
      periodHoldings: periodAgg.periodHoldings,
      latestOrders: periodAgg.latestOrders,
      recentSold: periodAgg.recentSold,
    };
  }

  /* ----- 卡片与摘要 ----- */

  private buildCard(
    p: NormalizedStrategyInput,
    agg: ReturnType<typeof aggregateNav>,
    loop: Awaited<ReturnType<TriggerBacktestServiceImpl['runMainLoop']>>,
    tradeDates: number[],
    bench: { ticker: string; name: string },
    sortFactors: StrategySortFactor[],
    periodRows: ReturnType<typeof aggregatePeriodRows>,
    timingStats: { positionDist: { label: string; days: number }[]; holdingDaysPct: number; missedRallies: { date: number; pct: number; exposure: number }[] } | null,
  ): BacktestCard {
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
        `持仓市值偏离目标总仓位 ±${p.positionDeviatePct}% 触发再平衡 ｜ 区间 ${p.startDate}~${p.endDate} ｜ 单边费率 ${feePct}%${p.slippageRate > 0 ? ` · 滑点 ${(p.slippageRate * 100).toFixed(2)}%` : ''}`,
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
        ...(p.keepRules.length
          ? [
              {
                label: '不卖条件',
                value: describeKeepRules(p.keepRules),
                hint: '命中的持仓继续持有：优先级高于全部卖出规则；择时的仓位调整不受保护',
              },
            ]
          : []),
        ...(timing
          ? [
              {
                label: '大盘择时',
                value: describeTimingOverlay(timing),
                hint: '字段条件逐日投票，状态机决定总仓位：牛市满仓、熊市保留仓位',
              },
            ]
          : []),
        { label: '初始资金/费用', value: `${(p.initialCapital / 10000).toFixed(0)} 万 · 单边 ${feePct}%${p.slippageRate > 0 ? ` · 滑点 ${(p.slippageRate * 100).toFixed(2)}%` : ''}`, hint: `已计交易费用 ${totalFee.toFixed(0)} 元` },
        { label: '业绩基准', value: bench.name },
      ],
      config: {
        strategyType: p.strategyType,
        securityIds: p.securityIds,
        startDate: p.startDate,
        endDate: p.endDate,
        initialCapital: p.initialCapital,
        feeRate: p.feeRate,
        ...(p.slippageRate > 0 ? { slippageRate: p.slippageRate } : {}),
        rebalanceIntervalDays: p.rebalanceIntervalDays,
        positionDeviatePct: p.positionDeviatePct,
        executionTiming: p.executionTiming,
        maxPositions: p.maxPositions,
        idealPositionPct: p.idealPositionPct,
        minPositionPct: p.minPositionPct,
        entryFilters: p.entryFilters,
        sortFactors: p.sortFactors,
        sellRules: p.sellRules,
        ...(p.keepRules.length ? { keepRules: p.keepRules } : {}),
        benchmark: p.benchmark,
        ...(timing ? { timingOverlay: timing } : {}),
      },
      dates: tradeDates,
      trades: loop.trades.slice(-50),
      monthly: agg.monthlyReturns,
      periods: periodRows.length ? periodRows : undefined,
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
      ...(p.keepRules.length ? { 不卖条件: describeKeepRules(p.keepRules) } : {}),
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
