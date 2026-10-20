import { forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  formatFnCall,
  PositionFn,
  resolvePositionFn,
  resolveWeightFn,
  spearman,
  validatePositionAmounts,
  WeightFn,
} from '../weight-functions';

// [实验] 引擎 B 引用已禁用
function industryEngine(): typeof import('../industry-engine') {
  throw new Error('industry-engine disabled in experiment');
}

import { ApiException } from '../../common/api.exception';
import {
  aggregateNav,
  aggregatePeriodRows,
  annualizeTurnover,
  applyEntryFilters,
  assertDailyScreenInput,
  assertStrategyInput,
  BENCHMARKS,
  buildPeriodHoldings,
  collectAllRefs,
  collectFactorRefs,
  DailyScreenInput,
  DailyScreenOutput,
  DEFAULT_MOMENTUM_FACTOR,
  describeExcludeRanges,
  describeFilters,
  describeKeepRules,
  describeSellRules,
  describeSortFactors,
  effectiveSortFactors,
  FactorRef,
  formatPct,
  INDEX_TABLE,
  INDEX_VALUE_KEY,
  indexFilterCode,
  isIndexFilterRule,
  LIMIT_DOWN_RATIO,
  LIMIT_UP_RATIO,
  LOT_SIZE,
  MAX_CANDIDATE_UNIVERSE,
  MAX_REBALANCES,
  NormalizedStrategyInput,
  rankUniverse,
  StrategyAggregate,
  ClarificationSignal,
  StrategyBacktestInput,
  StrategyBacktestOutput,
  StrategyBacktestService,
  StrategyFilterRule,
  StrategyKeepRule,
  StrategySellRule,
  StrategySortFactor,
  toDashDate,
  toStrategyMetricItems,
} from '../strategy-backtest.service';
 import { FactorDataService, QuoteRow, TradeDateCoverage } from '../factor-data.service';
 import { AgentProgressSink, BacktestCard } from '../../types';
 import { assertWhitelist, loadTableFields } from '../factor-schema';
import { TriggerBacktestService } from '../trigger-backtest.service';
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
import { todayStr } from '../../common/time';

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

/** 信号预计算的进度分批（调仓日数/批）：全市场截面一次约 0.4s，25 日约 10s，
 *  稳在长回测两批事件之间 < 90s 前端空闲看门狗 */
const SIGNAL_BATCH = 25;

/** 行情拉取的进度分批（只/批）：与取数服务内部分片同值——SQL 不变、缓存键不变，只逐批上报进度 */
const QUOTE_BATCH = 400;

interface RebalanceSignal {
  /** 有序候选（综合分降序，≤ maxPositions）；空 = 当日因子全缺，沿用持仓不换仓 */
  candidates: string[];
  /** 过滤后存活池的综合分排名（1 起）；rank_out 判断"持仓跌出 bottomN"用 */
  compositeRank: Map<string, number>;
  /** 综合分（仓位函数 ctx 用） */
  scores: Map<string, number>;
  /** 定权因子截面（factor_position，引擎按 params 因子引用在决策日预取） */
  sizingSection?: Map<string, number>;
}

@Injectable()
export class StrategyBacktestServiceImpl extends StrategyBacktestService {
  private readonly logger = new Logger('StrategyBacktest');

  constructor(
    private readonly factorData: FactorDataService,
    /** 模型 Ⅱ 触发引擎（rebalanceIntervalDays=0 路由目标）；smoke 脚本直构时可不装配 */
    @Optional()
    @Inject(forwardRef(() => TriggerBacktestService))
    private readonly triggerEngine?: TriggerBacktestService,
  ) {
    super();
  }

  /** 执行前快检：字典白名单（确认门 interrupt 前调用，让坏因子在用户确认前被打回，见契约注释） */
  preflight(refs: FactorRef[]): void {
    assertWhitelist(refs);
  }

  /** 区间快检 + 回测日历：日历源 = 首个被引用因子表（缺省用默认动量表）。
   *  确认门（interrupt 前）与引擎主流程共用：判定与报错文案同源——
   *  模型在用户确认前就拿到"可用区间 xxx~yyy"自纠参数，用户不会白确认一轮 */
  async checkRange(input: StrategyBacktestInput): Promise<TradeDateCoverage> {
    const p = assertStrategyInput(input);
    const refs = collectAllRefs(p);
    assertWhitelist(refs);
    const calendarTable = refs[0]?.table ?? DEFAULT_MOMENTUM_FACTOR.table;
    const coverage = await this.factorData.readTradeDates(calendarTable, p.startDate, p.endDate);
    if (Number(p.startDate) < coverage.min || Number(p.endDate) > coverage.max) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `回测区间超出数据范围：${calendarTable} 可用区间 ${coverage.min}~${coverage.max}，请调整 startDate/endDate`,
      );
    }
    return coverage;
  }

  async runStrategyBacktest(input: StrategyBacktestInput, onProgress?: AgentProgressSink): Promise<StrategyBacktestOutput> {
    const p = assertStrategyInput(input);
    if (p.rebalanceIntervalDays === 0 && (p.weightFn || p.positionFn)) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        '触发模式（模型 Ⅱ）暂不支持权重/仓位函数，请改用定期调仓模式',
      );
    }
    // [实验] 行业名校验已禁用

    // 函数解析（边界上一次）：未知函数名 → 400 附名录；参数不合法 → ClarificationSignal 引导模型修正
    const weightBinding = p.weightFn ? resolveWeightFn(p.weightFn) : null;
    const positionBinding = p.positionFn ? resolvePositionFn(p.positionFn) : null;
    console.error('[DEBUG bind]', 'weightFn:', JSON.stringify(p.weightFn ?? null), 'positionFn:', JSON.stringify(p.positionFn ?? null), 'binding fn:', typeof (positionBinding?.fn));
    const industries = p.industries ?? [];
    // 触发模式（rebalanceIntervalDays=0）路由到模型 Ⅱ 独立引擎
    if (p.rebalanceIntervalDays === 0) {
      if (!this.triggerEngine) {
        throw new ApiException('INVALID_ARGUMENT', 400, '模型 Ⅱ 触发引擎未装配（触发模式需要完整 DI 环境）');
      }
      return this.triggerEngine.run(p, onProgress);
    }
    const refs = collectFactorRefs(p);
    assertWhitelist([...collectAllRefs(p), ...(positionBinding?.factorRef ? [positionBinding.factorRef] : [])]);
    const sortFactors = effectiveSortFactors(p.sortFactors);
    const fieldSellRules = p.sellRules.filter((r): r is Extract<StrategySellRule, { kind: 'field' }> => r.kind === 'field');
    const rankOutBottomN: number | null = p.sellRules.some((r) => r.kind === 'rank_out')
      ? Math.min(...p.sellRules.filter((r) => r.kind === 'rank_out').map((r) => r.bottomN))
      : null;

    // ① 回测日历：区间快检（越界即抛，与确认门同文案）+ 区间内交易日
    const coverage = await this.checkRange(input);
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
    // 排除段（ADR-0002）：段内交易日只结算不交易；段内的调仓日不产生期行（无调仓发生）
    const frozenByDay: boolean[] = tradeDates.map((day) => p.excludeRanges.some((r) => day >= r.start && day <= r.end));
    const effectivePeriodStarts = rebalanceIdx.filter((idx) => !frozenByDay[idx]);
    const frozenCount = frozenByDay.filter(Boolean).length;
    if (frozenCount) {
      this.logger.log(`排除时间段 ${describeExcludeRanges(p.excludeRanges)}：覆盖 ${frozenCount} 个交易日（只结算不交易，冻结估值）`);
    }

    // ①′ 大盘条件（股票池开关）：按挂靠指数预载整段字段序列，逐调仓日广播成全池统一值
    const indexSeriesByKey = await this.loadIndexFilterSeries(p.entryFilters, p.startDate, p.endDate);

    // ② 第一遍（信号）：逐调仓日取因子截面 → 过滤 → 排序合成 → 有序候选；累计涉及股票
    // 按批发进度事件：批间静默约 10s，长区间回测也不会触发前端 90s 空闲看门狗误断
    const signals = new Map<DayIdx, RebalanceSignal>();
    const involved = new Set<string>(p.securityIds ?? []);
    const totalBatches = Math.ceil(rebalanceIdx.length / SIGNAL_BATCH);
    for (let b = 0; b < rebalanceIdx.length; b += SIGNAL_BATCH) {
      const batch = rebalanceIdx.slice(b, b + SIGNAL_BATCH);
      onProgress?.({
        type: 'tool_call',
        name: 'run_strategy_backtest',
        stage: '预计算回测信号',
        args: `第 ${Math.floor(b / SIGNAL_BATCH) + 1}/${totalBatches} 批 · 调仓日 ${String(tradeDates[batch[0]])} 起 ${batch.length} 个`,
      });
      for (const idx of batch) {
        const day = tradeDates[idx];
        // 信号函数上下文：滚动 IC（ic_weight）/ 定权因子截面（factor_position），仅在挂载相应函数时预取
        const icByFactor = weightBinding?.icWindow
          ? await this.computeRollingIC(sortFactors.factors, day, weightBinding.icWindow)
          : undefined;
        const sizingSection = positionBinding?.factorRef
          ? new Map(
              (
                await this.factorData.readFactorSection(
                  positionBinding.factorRef.table,
                  positionBinding.factorRef.field,
                  String(day),
                  p.securityIds ?? null,
                )
              ).map((r) => [r.securityId, r.value]),
            )
          : undefined;
        const dayPool = p.securityIds;
        const sig = await this.crossSectionSignal({
          entryFilters: p.entryFilters,
          sortFactors: sortFactors.factors,
          refs,
          securityIds: dayPool,
          indexSeriesByKey,
          day,
          weightFn: weightBinding?.fn,
          icByFactor,
        });
        const candidates = sig.ranked.slice(0, p.maxPositions).map((r) => r.code);
        const compositeRank = new Map(sig.ranked.map((r, i) => [r.code, i + 1]));
        const scores = new Map(sig.ranked.map((r) => [r.code, r.score]));
        signals.set(idx, { candidates, compositeRank, scores, sizingSection });
        for (const code of candidates) involved.add(code);
      }
      onProgress?.({
        type: 'tool_result',
        name: 'run_strategy_backtest',
        stage: '预计算回测信号',
        ok: true,
        detail: `已预计算 ${Math.min(b + SIGNAL_BATCH, rebalanceIdx.length)}/${rebalanceIdx.length} 个调仓日`,
      });
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
    // 行情按批拉取（每批 QUOTE_BATCH 只）：服务内部本就按同值分片执行，但一次全量调用
    // 会在整个装载期间静默（700+ 只 ≈ 110s > 前端 90s 空闲看门狗）——引擎自己分批才能逐批发事件
    const involvedCodes = [...involved];
    let quoteRows: QuoteRow[] = [];
    for (let i = 0; i < involvedCodes.length; i += QUOTE_BATCH) {
      const chunk = involvedCodes.slice(i, i + QUOTE_BATCH);
      const part = Math.floor(i / QUOTE_BATCH) + 1;
      const parts = Math.ceil(involvedCodes.length / QUOTE_BATCH);
      onProgress?.({
        type: 'tool_call',
        name: 'run_strategy_backtest',
        stage: '拉取行情日线',
        args: `第 ${part}/${parts} 批 · ${chunk.length} 只`,
      });
      const rows = await this.factorData.readQuoteSeries(chunk, p.startDate, p.endDate);
      quoteRows = quoteRows.concat(rows);
      onProgress?.({
        type: 'tool_result',
        name: 'run_strategy_backtest',
        stage: '拉取行情日线',
        ok: true,
        detail: `已拉取 ${part}/${parts} 批（累计 ${quoteRows.length} 行）`,
      });
    }
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
    const sellFieldSeries = await this.fetchFieldSeries(fieldSellRules, [...involved], p);
    // 不卖条件取数：与 field 类卖出规则同通道（日期表按日、静态表单值）
    const keepFieldSeries = await this.fetchFieldSeries(p.keepRules, [...involved], p);

    const bench = BENCHMARKS[p.benchmark];
    const indexRows = await this.factorData.readIndexDaily(INDEX_TABLE, bench.ticker, p.startDate, p.endDate);
    const indexByDate = new Map(indexRows.map((r) => [r.tradeDate, r]));
    const benchReturns = tradeDates.map((day) => {
      const row = indexByDate.get(toDashDate(day));
      return row && row.preClose > 0 ? row.close / row.preClose - 1 : 0;
    });

    // ③′ 择时序列（收拢于 timing.precomputeExposureSeries）：D 日收盘后的状态决定
    // D+1 目标仓位（首日无信号按初始牛 = 满仓）；缺值当日该规则弃权
    const timing = p.timingOverlay ?? null;
    let exposureByDay: number[];
    let bearDays = 0;
    if (timing) {
      ({ exposureByDay, bearDays } = await precomputeExposureSeries(
        timing,
        tradeDates,
        p.startDate,
        p.endDate,
        (table, field, ticker, start, end) => this.factorData.readIndexFieldSeries(table, field, ticker, start, end),
      ));
      this.logger.log(
        `择时启用：${BENCHMARKS[timing.index].name} ${timing.rules.length} 条件，` +
          `牛 ${tradeDates.length - bearDays} 日 / 熊 ${bearDays} 日，熊市仓位 ${timing.bearPositionPct}%`,
      );
    } else {
      exposureByDay = tradeDates.map(() => 100);
    }

    // ④ 主循环（逐交易日：执行 → 结算 → 信号；排除段只结算不交易）
    const loop = this.runMainLoop(
      p,
      tradeDates,
      rebalanceIdx,
      effectivePeriodStarts,
      signals,
      quotes,
      sellFieldSeries,
      sortFactors.factors,
      rankOutBottomN,
      positionBinding?.fn ?? null,
      exposureByDay,
      frozenByDay,
      p.keepRules,
      keepFieldSeries,
    );

    // ⑤ 聚合 → 卡片 + 摘要
    const aggregate = aggregateNav(loop.equities, benchReturns, tradeDates);
    aggregate.annualTurnoverPct = annualizeTurnover(loop.turnoverByDay, loop.equities);
    aggregate.metrics.turnover = aggregate.annualTurnoverPct; // 随 RawMetrics 落库，策略页与卡片同源展示
    const timingStats = timing
      ? {
          positionDist: positionDistribution(exposureByDay),
          holdingDaysPct: holdingDaysPct(exposureByDay),
          missedRallies: missedRallies(benchReturns, tradeDates, exposureByDay),
        }
      : null;
    const periodRows = aggregatePeriodRows({
      tradeDates,
      equities: loop.equities,
      benchReturns,
      turnoverByDay: loop.turnoverByDay,
      trades: loop.trades,
      periodStarts: effectivePeriodStarts,
      exposureByDay,
      initialCapital: p.initialCapital,
    });
    const card = this.buildCard(p, aggregate, loop, tradeDates, coverage, bench, sortFactors, rebalanceIdx.length, periodRows, timing, timingStats);
    card.periodHoldings = loop.periodHoldings;
    card.latestOrders = loop.latestOrders;
    card.recentSold = loop.recentSold;
    const summary = this.buildSummary(p, aggregate, loop, bench, rebalanceIdx.length, sortFactors, timing, timingStats);
    this.logger.log(
      `策略回测 ${p.startDate}~${p.endDate} 每${p.rebalanceIntervalDays}交易日: ` +
        `年化=${summary.年化收益} 回撤=${summary.最大回撤} 夏普=${summary.夏普比率} 交易 ${loop.trades.length} 笔 费用 ${summary.总费用}`,
    );
    return { card, summary, metrics: aggregate.metrics };
  }

  /* ----- 单日截面信号（回测信号预计算与每日选股共用） ----- */

  /** 大盘条件（entryFilters 引用指数表的规则）按挂靠指数预载整段字段序列：
   *  同 (table, field, indexCode) 只读一次，逐日广播时查内存 */
  private async loadIndexFilterSeries(
    entryFilters: StrategyFilterRule[],
    startDate: string,
    endDate: string,
  ): Promise<Map<string, Map<number, number>>> {
    const out = new Map<string, Map<number, number>>();
    for (const rule of entryFilters) {
      if (!isIndexFilterRule(rule)) continue;
      const key = `${rule.table}.${rule.field}#${indexFilterCode(rule)}`;
      if (out.has(key)) continue;
      const rows = await this.factorData.readIndexFieldSeries(
        rule.table,
        rule.field,
        BENCHMARKS[indexFilterCode(rule)].ticker,
        startDate,
        endDate,
      );
      out.set(key, new Map(rows.map((r) => [Number(r.tradeDate.replaceAll('-', '')), r.value])));
    }
    return out;
  }

  /**
   * 单日截面 → 过滤 → 排序合成（回测逐调仓日与每日选股的同一口径）：
   * 个股规则读当日截面；大盘条件从预载序列取当日值，以 INDEX_VALUE_KEY 哨兵键广播成全池统一值。
   */
  private async crossSectionSignal(opts: {
    entryFilters: StrategyFilterRule[];
    sortFactors: StrategySortFactor[];
    refs: FactorRef[];
    securityIds: string[] | null;
    indexSeriesByKey: Map<string, Map<number, number>>;
    day: number;
    /** 权重函数（已绑定参数）：本次截面求值各因子权重；缺省 = 等权 */
    weightFn?: WeightFn;
    /** 滚动 Rank IC 均值（ic_weight 的引擎预计算上下文，键 = table.field） */
    icByFactor?: Record<string, number>;
  }): Promise<{
    rawPoolSize: number;
    ranked: { code: string; score: number }[];
    /** 截面按 table.field 键索引（每日选股回填入选股的因子值用） */
    sectionsByKey: Map<string, Map<string, number>>;
  }> {
    const { entryFilters, sortFactors, refs, securityIds, indexSeriesByKey, day, weightFn, icByFactor } = opts;
    const sections = await Promise.all(
      refs.map((ref) => this.factorData.readFactorSection(ref.table, ref.field, String(day), securityIds)),
    );
    const byRef = new Map<string, Map<string, number>>();
    refs.forEach((ref, i) => {
      byRef.set(`${ref.table}.${ref.field}`, new Map(sections[i].map((r) => [r.securityId, r.value])));
    });
    // 过滤池：全市场时取全部截面键的并集（缺值股票由过滤/合成逻辑剔除）
    const rawPool = securityIds ?? [...new Set(sections.flat().map((r) => r.securityId))];
    // 过滤/排序按列名各取各的截面：refs 是合并去重列表，按下标会把过滤列喂给排序
    const filterSections = entryFilters.map((f) => {
      if (!isIndexFilterRule(f)) return byRef.get(`${f.table}.${f.field}`)!;
      const v = indexSeriesByKey.get(`${f.table}.${f.field}#${indexFilterCode(f)}`)?.get(day);
      return new Map<string, number>(v === undefined ? [] : [[INDEX_VALUE_KEY, v]]);
    });
    const rankSections = sortFactors.map((f) => byRef.get(`${f.table}.${f.field}`)!);
    const pool = applyEntryFilters(rawPool, entryFilters, filterSections);
    const weights = weightFn
      ? weightFn({
          factors: sortFactors,
          sections: rankSections,
          icByFactor,
          pool,
          count: pool.length,
        })
      : undefined;
    return { rawPoolSize: rawPool.length, ranked: rankUniverse(sortFactors, rankSections, pool, weights), sectionsByKey: byRef };
  }

  /** 每日选股（果仁「每日选股」对标）：不跑回测主循环、零交易零副作用，
   *  过滤/排序口径与回测信号完全一致（同一对纯函数 + 同一广播通道） */
  async runDailyScreen(input: DailyScreenInput): Promise<DailyScreenOutput> {
    const p = assertDailyScreenInput(input);
    const weightBinding = p.weightFn ? resolveWeightFn(p.weightFn) : null;
    const industries = p.industries ?? [];
    const refs = collectFactorRefs({ entryFilters: p.entryFilters, sortFactors: p.sortFactors, sellRules: [], keepRules: [] });
    assertWhitelist([
      ...refs,
      ...p.entryFilters.filter(isIndexFilterRule).map((r) => ({ table: r.table, field: r.field })),
    ]);

    // 日历：因子引用首表（与回测同源）；查询日缺省 = 最近交易日，非交易日自动回落到前一个交易日
    const calendarTable = refs[0]?.table ?? DEFAULT_MOMENTUM_FACTOR.table;
    const today = Number(todayStr().replaceAll('-', ''));
    const coverage = await this.factorData.readTradeDates(calendarTable, '19000101', String(today));
    let queryDate: number;
    if (p.date) {
      const d = Number(p.date);
      if (d > coverage.max) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `查询日超出数据范围：${calendarTable} 可用区间 ${coverage.min}~${coverage.max}，请调整 date`,
        );
      }
      const prev = [...coverage.dates].reverse().find((x) => x <= d);
      if (prev === undefined) {
        throw new ApiException('INVALID_ARGUMENT', 400, `查询日 ${p.date} 早于数据起点（${calendarTable} 自 ${coverage.min} 起），请调整 date`);
      }
      queryDate = prev;
    } else {
      const last = coverage.dates[coverage.dates.length - 1];
      if (last === undefined) {
        throw new ApiException('INVALID_ARGUMENT', 400, `表 ${calendarTable} 无可用交易日数据`);
      }
      queryDate = last;
    }

    const indexSeriesByKey = await this.loadIndexFilterSeries(p.entryFilters, String(coverage.dates[0] ?? queryDate), String(queryDate));
    // 与回测排序口径一致：ic_weight 挂载时同样预取滚动 IC
    const icByFactor = weightBinding?.icWindow
      ? await this.computeRollingIC(p.sortFactors, queryDate, weightBinding.icWindow)
      : undefined;
    const industryPool = p.securityIds;
    const sig = await this.crossSectionSignal({
      entryFilters: p.entryFilters,
      sortFactors: p.sortFactors,
      refs,
      securityIds: industryPool,
      indexSeriesByKey,
      day: queryDate,
      weightFn: weightBinding?.fn,
      icByFactor,
    });
    const stocks = sig.ranked.slice(0, p.maxPositions).map((r) => ({
      code: r.code,
      score: r.score,
      factorValues: p.sortFactors.map((f) => sig.sectionsByKey.get(`${f.table}.${f.field}`)?.get(r.code) ?? null),
    }));
    this.logger.log(
      `每日选股 ${queryDate}：过滤前 ${sig.rawPoolSize} → 存活 ${sig.ranked.length} → 入选前 ${stocks.length}` +
        `${p.usedDefaultSort ? '（排序因子缺省 → 默认 20 日动量）' : ''}`,
    );
    return {
      date: queryDate,
      ...(weightBinding ? { 权重函数: formatFnCall('factor-weight', p.weightFn) } : {}),
      stocks,
      sortFactors: p.sortFactors,
      usedDefaultSort: p.usedDefaultSort,
      entryFilters: p.entryFilters,
      rawPoolSize: sig.rawPoolSize,
      survivedCount: sig.ranked.length,
    };
  }

  /* ----- 主循环：逐交易日 执行 → 结算 → 信号 ----- */

  private runMainLoop(
    p: NormalizedStrategyInput,
    tradeDates: number[],
    rebalanceIdx: DayIdx[],
    periodStarts: DayIdx[],
    signals: Map<DayIdx, RebalanceSignal>,
    quotes: Map<string, Map<number, Quote>>,
    sellFieldSeries: SellFieldData,
    sortFactors: StrategySortFactor[],
    rankOutBottomN: number | null,
    positionFn: PositionFn | null,
    exposureByDay: number[],
    frozenByDay: boolean[],
    keepRules: StrategyKeepRule[],
    keepFieldSeries: SellFieldData,
  ) {
    const staticSellRefs = new Set(
      p.sellRules.filter((r) => r.kind === 'field').map((r) => `${r.table}.${r.field}`)
        .filter((key) => !this.isDateTable(key.split('.')[0])),
    );
    const staticKeepRefs = new Set(
      keepRules.map((r) => `${r.table}.${r.field}`).filter((key) => !this.isDateTable(key.split('.')[0])),
    );

    const account = new Account(p.initialCapital, { feeRate: p.feeRate });
    const equities: number[] = [];
    const turnoverByDay: number[] = [];
    let pendingSells = new Map<string, string>(); // code → 触发原因
    let pendingRebalance: RebalanceSignal | null = null;
    const sizingViolations: string[] = []; // 仓位函数金额的前置校验修正清单（整手/现金）

    const quoteOf = (code: string, day: number): Quote | undefined => quotes.get(code)?.get(day);
    /** 执行价：0=开盘 1=收盘；停牌/开盘价缺失 → undefined（当日不可交易该标的） */
    const execPriceOf = (code: string, day: number): number | undefined => {
      const q = quoteOf(code, day);
      if (!q) return undefined;
      return p.executionTiming === 0 ? (q.open ?? undefined) : q.close;
    };

    const rebalanceIdxSet = new Set(rebalanceIdx);

    for (let i = 0; i < tradeDates.length; i++) {
      const day = tradeDates[i];

      // ── 排除段（ADR-0002）：只结算不交易——挂起指令丢弃、信号停算，
      //    持仓不喂新价、按冻结时点价估值（净值走平，行情涨跌不进收益）──
      if (frozenByDay[i]) {
        pendingSells = new Map();
        pendingRebalance = null;
        equities.push(account.settle(() => undefined));
        turnoverByDay.push(account.takeDayTurnover());
        continue;
      }

      // ── 执行阶段：昨日盘后生成的指令 ──
      if (i > 0) {
        // a. 卖出指令（卖出规则触发）：停牌/跌停顺延，T+1 保护
        for (const [code, reason] of pendingSells) {
          const pos = account.positionOf(code);
          if (!pos) continue;
          if (pos.buyDayIdx >= i) continue; // T+1：当日买入不可卖
          const price = execPriceOf(code, day);
          const q = quoteOf(code, day);
          if (price === undefined || !q) continue; // 停牌：持仓顺延
          if (price <= q.preClose * LIMIT_DOWN_RATIO) continue; // 跌停顺延
          account.sellAll(pos, price, day, reason);
        }
        pendingSells = new Map();

        // a′. 择时缩放块：目标总仓位（昨收状态）与当前持仓市值的偏差超 positionDeviatePct%（缺省 1）时拉回——
        // 独立于调仓日（候选为空也执行）；减仓按市值占比分摊、只卖未 T+1 锁定仓，停牌/涨跌停顺延。
        // 不查不卖条件（ADR-0003：择时是组合级仓位管理，不受单票保护）
        account.rebalanceToTotal(
          exposureByDay[i] ?? 100,
          p.positionDeviatePct ?? 1,
          day,
          i,
          { trim: '择时减仓', add: '择时加仓' },
          {
            priceOf: (code) => execPriceOf(code, day),
            canSell: (code, price) => {
              const q = quoteOf(code, day);
              return !!q && price > q.preClose * LIMIT_DOWN_RATIO;
            },
            canBuy: (code, price) => {
              const q = quoteOf(code, day);
              return !!q && price < q.preClose * LIMIT_UP_RATIO;
            },
          },
        );

        // b. 调仓指令：先卖非目标/强制卖出，再按综合分序买入候选，最后已持有的调回目标仓位
        if (pendingRebalance) {
          const { candidates, compositeRank, scores, sizingSection } = pendingRebalance;
          if (candidates.length) {
            const targetSet = new Set(candidates);
            const equity0 = account.equity((code) => execPriceOf(code, day));
            const minMv = (equity0 * p.minPositionPct) / 100;
            // 目标市值乘择时暴露系数：熊市仓位 <100% 时，调仓自然落在降档仓位内
            const targetMv = ((equity0 * p.idealPositionPct) / 100) * ((exposureByDay[i] ?? 100) / 100);

            // 仓位函数：每股独立目标金额（缺省 null = 等权 targetMv，现状路径）；
            // 字典缺省成员（如不卖条件保住的持仓）在 b3 回退等权目标，防误清仓
            let sizingTargets: Map<string, number> | null = null;
            if (positionFn) {
              const raw = positionFn({
                candidates: candidates.map((code, idx) => ({
                  code,
                  rank: compositeRank.get(code) ?? idx + 1,
                  score: scores.get(code) ?? 0,
                })),
                sizingSection,
                remainingCash: targetMv,
                remainingPct: (p.idealPositionPct * (exposureByDay[i] ?? 100)) / 100,
                maxPositions: p.maxPositions,
              });
              const { fixed, violations: vs } = validatePositionAmounts(raw, {
                cash: Math.min(targetMv, account.cash()),
                priceOf: (code) => execPriceOf(code, day),
              });
              sizingTargets = new Map(Object.entries(fixed));
              for (const v of vs) sizingViolations.push(`D${day} ${v}`);
            }
            // b2 新买：函数未分配金额的候选 = 不买（0）；b3 持仓调平：未分配成员回退等权目标，防误清仓
            const tvOf = (code: string, isExisting: boolean): number =>
              sizingTargets ? (sizingTargets.get(code) ?? (isExisting ? targetMv : 0)) : targetMv;

            // b1. 清出不在目标（或被 rank_out 强制卖出）的持仓；不卖条件命中 = 受保护，
            //     不被调出、按目标仓位同权调平（ADR-0003）
            const keptCodes = new Set<string>();
            for (const pos of account.allPositions()) {
              const forced = rankOutBottomN !== null && this.rankOutOf(pos.code, compositeRank, rankOutBottomN);
              if (targetSet.has(pos.code) && !forced) continue;
              if (keepRules.length && matchKeepRule(pos, day, keepRules, keepFieldSeries, staticKeepRefs)) {
                keptCodes.add(pos.code);
                continue;
              }
              if (pos.buyDayIdx >= i) continue; // T+1 保护
              const price = execPriceOf(pos.code, day);
              const q = quoteOf(pos.code, day);
              if (price === undefined || !q) continue; // 停牌顺延：明日重试
              if (price <= q.preClose * LIMIT_DOWN_RATIO) continue; // 跌停顺延
              account.sellAll(pos, price, day, forced ? '排名跌出' : '调仓卖出');
            }

            // b2. 按综合分序买入未持有的候选：整手向下取整，现金不足缩股，低于最小建仓仓位放弃（顺延下一候选）。
            //     持仓数达 maxPositions 即停止买入——不卖条件保住的持仓占坑（ADR-0003：保 2 买 8）
            for (const code of candidates) {
              if (account.positionOf(code)) continue;
              if (account.size() >= p.maxPositions) break;
              const price = execPriceOf(code, day);
              const q = quoteOf(code, day);
              if (price === undefined || !q) continue; // 停牌跳过
              if (price >= q.preClose * LIMIT_UP_RATIO) continue; // 涨停跳过
              const tv = tvOf(code, false);
              if (tv <= 0) continue; // 仓位函数给了 0 金额 = 本期不买（如 MA 下方）
              let shares = Math.floor(tv / (price * (1 + p.feeRate)) / LOT_SIZE) * LOT_SIZE;
              const affordable = account.affordableShares(price);
              if (shares > affordable) shares = affordable;
              if (!Number.isFinite(shares) || shares < LOT_SIZE || shares * price < minMv) continue; // 顺延下一候选
              account.buy(code, shares, price, day, i, '调仓建仓');
            }

            // b3. 已持有且在目标（或被不卖条件保住）的仓位调回目标市值（差额整手；减持部分同样整手，
            //     不足一手不动）——被保股与新入选同权，视同正式成员
            for (const code of new Set([...candidates, ...keptCodes])) {
              const pos = account.positionOf(code);
              if (!pos) continue;
              if (pos.buyDayIdx >= i) continue; // T+1 保护
              const price = execPriceOf(code, day);
              if (price === undefined) continue;
              // 字典未覆盖的成员（如不卖条件保住的持仓）→ 回退等权目标，防误清仓
              const tv = tvOf(code, true);
              const diff = Math.floor(tv / price / LOT_SIZE) * LOT_SIZE - pos.shares;
              if (diff > 0) {
                let shares = Math.floor(diff / LOT_SIZE) * LOT_SIZE;
                const affordable = account.affordableShares(price);
                if (shares > affordable) shares = affordable;
                if (Number.isFinite(shares) && shares >= LOT_SIZE && shares * price >= minMv) account.buy(code, shares, price, day, i, '调仓补仓');
              } else if (diff < 0) {
                const shares = Math.floor(-diff / LOT_SIZE) * LOT_SIZE;
                if (Number.isFinite(shares) && shares >= LOT_SIZE) account.sell(pos, shares, price, day, '调仓减持');
              }
            }
          }
          pendingRebalance = null;
        }
      }

      // ── 结算阶段：权益 = 现金 + Σ(持仓 × 收盘)；停牌用最近有效收盘估值 ──
      equities.push(account.settle((code) => quoteOf(code, day)?.close));
      turnoverByDay.push(account.takeDayTurnover());

      // ── 信号阶段（D 日收盘后）：卖出规则逐持仓检查 + 调仓日落目标持仓，指令 D+1 执行 ──
      if (p.sellRules.length && account.size() > 0) {
        for (const pos of account.allPositions()) {
          if (pos.buyDayIdx >= i) continue; // T+1：当日买入的明日才可能触发卖出
          if (keepRules.length && matchKeepRule(pos, day, keepRules, keepFieldSeries, staticKeepRefs)) continue; // 不卖条件：跳过本轮卖出检查
          const close = quoteOf(pos.code, day)?.close ?? account.lastCloseOf(pos.code);
          if (close === undefined) continue;
          const reason = matchSellRule(pos, close, i, day, p.sellRules, sellFieldSeries, staticSellRefs);
          if (reason) pendingSells.set(pos.code, reason);
        }
      }
      if (rebalanceIdxSet.has(i)) {
        pendingRebalance = signals.get(i) ?? null;
      }
    }

    const finalEquity = equities[equities.length - 1] ?? p.initialCapital;
    // 每期持仓明细：重放交易流水（调仓模式按调仓期切；排除段内的调仓日不产生期行）
    const periodAgg = buildPeriodHoldings(account.trades(), tradeDates, periodStarts, (code, day) =>
      quoteOf(code, day)?.close ?? account.lastCloseOf(code),
    );
    return {
      cash: account.cash(),
      positions: account.positionsMap(),
      trades: account.trades(),
      equities,
      turnoverByDay,
      finalEquity,
      sizingViolations,
      lastClose: account.lastCloseMap(),
      periodHoldings: periodAgg.periodHoldings,
      latestOrders: periodAgg.latestOrders,
      recentSold: periodAgg.recentSold,
    };
  }

  /** rank_out 判定：持仓股不在过滤后存活池（无排名）或排名跌出 bottomN 即命中 */
  private rankOutOf(code: string, compositeRank: Map<string, number>, bottomN: number): boolean {
    const rank = compositeRank.get(code);
    return rank === undefined || rank > bottomN;
  }

  /** ic_weight 上下文：各因子在决策日前的滚动 Spearman Rank IC 均值。
   *  窗口配对 = (截面@d_k, d_k→d_{k+1} 前复权收益)，末对 = (D-1 截面, D 收盘收益)，无未来泄漏。
   *  数据成本：窗口内每日全市场因子截面 + 一次全窗口行情，缓存→数据库（因子值唯一事实）。 */
  private async computeRollingIC(
    factors: { table: string; field: string }[],
    day: number,
    window: number,
  ): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (!factors.length || window <= 0) return out;
    const cov = await this.factorData.readTradeDates(factors[0].table, '19000101', String(day));
    const dates = cov.dates.filter((d) => d <= day).slice(-(window + 1));
    if (dates.length < 2) return out;
    const sectionsByDate: Map<number, Map<string, number>>[] = factors.map(() => new Map());
    const codes = new Set<string>();
    for (const d of dates) {
      for (let fi = 0; fi < factors.length; fi++) {
        const rows = await this.factorData.readFactorSection(factors[fi].table, factors[fi].field, String(d), null);
        const m = new Map<string, number>();
        for (const r of rows) {
          m.set(r.securityId, r.value);
          codes.add(r.securityId);
        }
        sectionsByDate[fi].set(d, m);
      }
    }
    const quoteRows = await this.factorData.readQuoteSeries(
      [...codes],
      String(dates[0]),
      String(dates[dates.length - 1]),
    );
    const closes = new Map<string, Map<number, number>>();
    for (const row of quoteRows) {
      const code = `${row.ticker}.${row.exchange}`;
      let byDate = closes.get(code);
      if (!byDate) {
        byDate = new Map<number, number>();
        closes.set(code, byDate);
      }
      byDate.set(Number(row.tradeDate.replaceAll('-', '')), row.close);
    }
    factors.forEach((f, fi) => {
      let sum = 0;
      let n = 0;
      for (let k = 0; k + 1 < dates.length; k++) {
        const d0 = dates[k];
        const d1 = dates[k + 1];
        const sec = sectionsByDate[fi].get(d0);
        if (!sec || !sec.size) continue;
        const xs: (number | undefined)[] = [];
        const ys: (number | undefined)[] = [];
        for (const [code, v] of sec) {
          const c0 = closes.get(code)?.get(d0);
          const c1 = closes.get(code)?.get(d1);
          if (c0 === undefined || c1 === undefined || c0 <= 0) continue;
          xs.push(v);
          ys.push((c1 / c0 - 1) * 100);
        }
        sum += spearman(xs, ys);
        n++;
      }
      out[`${f.table}.${f.field}`] = n > 0 ? sum / n : 0;
    });
    return out;
  }

  /** 字段条件的区间序列预取（field 类卖出规则与不卖条件共用）：带 TRADE_DATE 的表按日构建；静态表单值 */
  private async fetchFieldSeries(
    rules: { table: string; field: string }[],
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
    periodRows: ReturnType<typeof aggregatePeriodRows>,
    timing: StrategyTimingOverlay | null,
    timingStats: { positionDist: { label: string; days: number }[]; holdingDaysPct: number; missedRallies: { date: number; pct: number; exposure: number }[] } | null,
  ): BacktestCard {
    const feePct = (p.feeRate * 100).toFixed(2);
    const sortExpr = sortFactors.factors
      .map((f) => `${f.field}${f.direction === -1 ? '(小值优)' : ''}`)
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
        `${sortFactors.usedDefault ? '（值大优）' : ''}` +
        `${timing ? ` ｜ 大盘择时：字段条件逐日投票，熊市仓位 ${timing.bearPositionPct}%` : ''}`,
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
          value: describeSortFactors(sortFactors.factors, '\n'),
          hint: sortFactors.usedDefault
            ? 'sortFactors 未传，引擎兜底追加默认 20 日动量（REVS20，值大优）'
            : '各因子截面分位数标准化（0~100）后加权合成综合分（weight 缺省等权 1/N）',
        },
        {
          label: '过滤因子',
          value: describeFilters(p.entryFilters, '\n'),
          hint: '全部满足才入选；个股字段缺失视为不满足、大盘字段缺值弃权（不清空股票池）',
        },
        ...(p.weightFn
          ? [{ label: '权重函数', value: formatFnCall('factor-weight', p.weightFn), hint: '每次调仓求值；参数只放策略旋钮，因子截面由引擎按缓存→数据库供给' }]
          : []),
        ...(p.positionFn
          ? [{ label: '仓位函数', value: formatFnCall('position', p.positionFn), hint: '每股目标金额 = 函数输出，经整手/现金校验器逐条修正后执行' }]
          : []),
        ...(loop.sizingViolations.length
          ? [{ label: '仓位校验', value: loop.sizingViolations.join('；'), hint: '仓位函数金额的前置校验修正清单（整手/现金）' }]
          : []),
        ...(p.keepRules.length
          ? [
              {
                label: '不卖条件',
                value: describeKeepRules(p.keepRules, '\n'),
                hint: '命中的持仓继续持有：优先级高于全部卖出规则与调仓换出，被保股按目标仓位同权调平；大盘择时的仓位调整不受保护',
              },
            ]
          : []),
        ...(p.excludeRanges.length
          ? [
              {
                label: '排除时间段',
                value: describeExcludeRanges(p.excludeRanges),
                hint: '段内只结算不交易：持仓按冻结时点价估值（净值走平），指标按全序列计算',
              },
            ]
          : []),
        {
          label: '卖出规则',
          value: describeSellRules(p.sellRules),
          hint: '持仓期每日收盘后检查，命中次日执行；rank_out 在调仓日按综合分排名生效',
        },
        ...(timing
          ? [
              {
                label: '大盘择时',
                value: describeTimingOverlay(timing),
                hint: '字段条件逐日投票（成立=牛票），状态机决定总仓位：牛市满仓、熊市保留仓位；信号 T 日收盘、T+1 执行',
              },
            ]
          : []),
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
        ...(p.keepRules.length ? { keepRules: p.keepRules } : {}),
        ...(p.excludeRanges.length ? { excludeRanges: p.excludeRanges } : {}),
        benchmark: p.benchmark,
        ...(timing ? { timingOverlay: timing } : {}),
      },
      // 逐点交易日（YYYYMMDD）：前端 x 轴按真实日期打刻度
      dates: tradeDates,
      // 交易明细（卡片截最近 50 笔；全量见 summary 统计）
      trades: loop.trades.slice(-50),
      // 月度归因
      monthly: agg.monthlyReturns,
      // 择时证据三件套（未启用择时则缺省；前端按"仓位分布"区块渲染）
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
    agg: StrategyAggregate,
    loop: ReturnType<StrategyBacktestServiceImpl['runMainLoop']>,
    bench: { ticker: string; name: string },
    rebalanceCount: number,
    sortFactors: { factors: StrategySortFactor[]; usedDefault: boolean },
    timing: StrategyTimingOverlay | null,
    timingStats: { positionDist: { label: string; days: number }[]; holdingDaysPct: number; missedRallies: { date: number; pct: number; exposure: number }[] } | null,
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
      ...(p.keepRules.length ? { 不卖条件: describeKeepRules(p.keepRules) } : {}),
      ...(p.excludeRanges.length ? { 排除时间段: describeExcludeRanges(p.excludeRanges) } : {}),
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
            择时规则: describeTimingOverlay(timing!),
            仓位分布: timingStats.positionDist.map((b) => `${b.label}:${b.days}日`).join(' '),
            持股时间占比: `${timingStats.holdingDaysPct}%`,
            踏空归因: timingStats.missedRallies
              .map((m) => `${m.date} 基准${formatPct(m.pct)}(仓位${m.exposure}%)`)
              .join(' ') || '无（择时期间未错过基准大涨日）',
          }
        : {}),
      ...(p.weightFn ? { 权重函数: formatFnCall('factor-weight', p.weightFn) } : {}),
      ...(p.positionFn ? { 仓位函数: formatFnCall('position', p.positionFn) } : {}),
      ...(loop.sizingViolations.length
        ? { 仓位校验: loop.sizingViolations.slice(-6).join('；').slice(0, 300) }
        : {}),
      期末持仓: finalPositions.slice(0, 5),
      月度收益: agg.monthlyReturns.map((m) => `${m.month}:${formatPct(m.pct)}`).join(' '),
      提示: '回测卡片已生成并将随回复展示；请用不超过 90 字总结以上结果，只能引用返回数字，不要编造，结尾用短句提醒不构成投资建议。',
    };
  }
}
