import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import {
  aggregatePerformance,
  assertBacktestInput,
  BacktestFactor,
  BENCHMARKS,
  compositeTopK,
  DAILY_MAX_REBALANCES,
  EqualWeightBacktestInput,
  EqualWeightBacktestOutput,
  EqualWeightBacktestService,
  formatPct,
  FREQUENCY_LABELS,
  groupRebalanceDates,
  NormalizedBacktestInput,
  toBacktestMetricItems,
  toDashDate,
} from '../equal-weight-backtest.service';
import { FactorDataService } from '../factor-data.service';
import { loadTableFields, listKnownTables } from '../factor-schema';

/* ==========================================================
   等权回测实现：只编排与计算，不触库——
   全部数据经 FactorDataService 批量方法取数（连接池/白名单由其负责）。

   内存口径（逐年滚动）：任一时刻内存里只有"一个日历年 × 该年持仓并集"的
   前复权收盘面板；全年用完即弃，全局只保留日收益/换手序列（~1300 个数）。
   全市场 × 5 年的完整面板从不进入内存。

   年窗口说明：调仓期 = (调仓日 D_i, 下一调仓日 D_i+1]，12 月那期的收益日
   会跨到次年首个调仓日，因此每年的行情拉取窗口为
   [当年首个调仓日, 次年首个调仓日]（末年取 endDate），恰好覆盖跨年段。
   ========================================================== */

/** 个股前复权日行情表（SQL/mkt_equd_adj.md） */
const QUOTE_TABLE = 'mkt_equd_adj';

/** 指数日行情表（SQL/mkt_idxd.md），基准曲线数据源 */
const INDEX_TABLE = 'mkt_idxd';

@Injectable()
export class EqualWeightBacktestServiceImpl extends EqualWeightBacktestService {
  private readonly logger = new Logger('EqualWeightBacktest');

  constructor(private readonly factorData: FactorDataService) {
    super();
  }

  /** 执行前快检：字典白名单（确认门 interrupt 前调用，让坏因子在用户确认前被打回，见契约注释） */
  preflight(factors: BacktestFactor[]): void {
    this.assertWhitelist(factors);
  }

  async runEqualWeightBacktest(input: EqualWeightBacktestInput): Promise<EqualWeightBacktestOutput> {
    const p = assertBacktestInput(input);
    this.assertWhitelist(p.factors);

    // ① 回测日历：区间内交易日 + 全表可用范围校验
    const coverage = await this.factorData.readTradeDates(p.factors[0].table, p.startDate, p.endDate);
    if (Number(p.startDate) < coverage.min || Number(p.endDate) > coverage.max) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `回测区间超出数据范围：${p.factors[0].table} 可用区间 ${coverage.min}~${coverage.max}，请调整 startDate/endDate`,
      );
    }
    if (coverage.dates.length < 2) {
      throw new ApiException('INVALID_ARGUMENT', 400, `区间 ${p.startDate}~${p.endDate} 内因子交易日不足（${coverage.dates.length} 天），无法回测`);
    }

    // ② 调仓日：按频率分组取组内最后一个交易日；日频档有期数上限（兜住逐日取数的查询量）
    const rebalanceDates = groupRebalanceDates(coverage.dates, p.frequency, p.everyNTd);
    if (rebalanceDates.length < 2) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `区间内调仓期数不足（仅 ${rebalanceDates.length} 期，至少 2 期）：请扩大区间或提高调仓频率`,
      );
    }
    if (p.frequency === 'daily' && rebalanceDates.length > DAILY_MAX_REBALANCES) {
      throw new ApiException(
        'INVALID_ARGUMENT',
        400,
        `日频调仓区间过长：${rebalanceDates.length} 个交易日（上限 ${DAILY_MAX_REBALANCES}，约两年）。请缩短区间或改用更低频率`,
      );
    }

    // ③ 每个调仓日：各因子取全截面 → 分位数等权合成 → 按综合分 Top-K
    const holdings: string[][] = [];
    for (const date of rebalanceDates) {
      const sections = await Promise.all(
        p.factors.map((f) => this.factorData.readCrossSection(f.table, f.field, String(date))),
      );
      holdings.push(compositeTopK(p.factors, sections, p.topK));
    }
    // 调仓日因子值全空的期跳过（沿用上期持仓）：日频下个别交易日因子缺失是常态，
    // 不因单日空值整体报错；全部为空/有效期不足 2 期才报错
    const periods: number[] = [];
    const periodHoldings: string[][] = [];
    for (let i = 0; i < rebalanceDates.length; i++) {
      if (!holdings[i].length) continue;
      periods.push(rebalanceDates[i]);
      periodHoldings.push(holdings[i]);
    }
    if (periods.length < 2) {
      throw new ApiException('INVALID_ARGUMENT', 400, `因子可用调仓期不足（仅 ${periods.length} 期，至少 2 期），请更换因子或区间`);
    }

    // ④ 逐年拉取"该年持仓并集"的前复权日收盘（跨年段由次年首个调仓日收口）
    const closes = await this.fetchYearlyCloses(p, periods, periodHoldings);

    // ⑤ 逐期计算组合日收益（持有期内日度等权再平衡）与各期单边换手
    const prevTradingDay = new Map<number, number>();
    for (let i = 1; i < coverage.dates.length; i++) prevTradingDay.set(coverage.dates[i], coverage.dates[i - 1]);
    const portfolioReturns: number[] = [];
    const returnDates: number[] = [];
    const turnovers: number[] = [];
    const periodFirstIdx: number[] = []; // 每期首个日收益在 portfolioReturns 中的下标（费用计提点）
    for (let i = 0; i < periods.length; i++) {
      periodFirstIdx.push(portfolioReturns.length);
      const periodEnd = i + 1 < periods.length ? periods[i + 1] : Number(p.endDate);
      for (const day of coverage.dates) {
        if (day <= periods[i] || day > periodEnd) continue;
        portfolioReturns.push(this.equalWeightDayReturn(periodHoldings[i], closes, day, prevTradingDay.get(day)));
        returnDates.push(day);
      }
      if (i > 0) turnovers.push(this.periodTurnover(periodHoldings[i - 1], periodHoldings[i]));
    }

    // ⑤b 交易费用：在第 i 期的首个收益日计提。首期建仓只买（单边 1×feeRate）；
    //    之后每期卖旧买新，双边合计 2×单边换手×feeRate。未换手（换手 0）不计。
    if (p.feeRate > 0) {
      for (let i = 0; i < periods.length; i++) {
        const cost = i === 0 ? p.feeRate : 2 * (turnovers[i - 1] ?? 0) * p.feeRate;
        const idx = periodFirstIdx[i];
        if (cost > 0 && idx < portfolioReturns.length) {
          portfolioReturns[idx] = (1 + portfolioReturns[idx]) * (1 - cost) - 1;
        }
      }
    }

    // ⑥ 基准曲线（指数日收益，按组合交易日对齐）
    const bench = BENCHMARKS[p.benchmark];
    const indexRows = await this.factorData.readIndexDaily(INDEX_TABLE, bench.ticker, p.startDate, p.endDate);
    const indexByDate = new Map(indexRows.map((r) => [r.tradeDate, r]));
    const benchReturns = returnDates.map((day) => {
      const row = indexByDate.get(toDashDate(day));
      return row && row.preClose > 0 ? row.close / row.preClose - 1 : 0;
    });

    // ⑦ 聚合 → 卡片 + 摘要
    const years = portfolioReturns.length / 252;
    const aggregate = aggregatePerformance(portfolioReturns, benchReturns, turnovers, periods.length / years);
    const frequencyLabel = this.frequencyLabel(p);
    const factorExpr = p.factors.map((f) => f.field + (f.order === 'asc' ? '(小值优)' : '')).join(' + ');
    const card = {
      type: 'backtest' as const,
      title: `${factorExpr} 等权回测`,
      tag: `等权回测·${frequencyLabel}`,
      note:
        `因子 ${factorExpr}（各因子截面分位数等权合成） ｜ 区间 ${p.startDate}~${p.endDate} ｜ ` +
        `${frequencyLabel}调仓 ${periods.length} 期 ｜ 每期持仓≤${p.topK} 只 ｜ ` +
        `单边换手${p.feeRate > 0 ? `，费用单边 ${(p.feeRate * 100).toFixed(2)}%` : '，未计交易费用'} ｜ 个股缺行情日按 0 收益`,
      curve: aggregate.curve,
      benchCurve: aggregate.benchCurve,
      benchName: bench.name,
      metrics: toBacktestMetricItems(aggregate),
      // 本次回测真实参数（前端"回测参数"块按卡片渲染，不再显示策略页配置项）
      params: [
        {
          label: '回测区间',
          value: `${toDashDate(Number(p.startDate))} ~ ${toDashDate(Number(p.endDate))}`,
          hint: `因子交易日范围内的实际回测起止（因子表可用区间 ${coverage.min}~${coverage.max}）`,
        },
        {
          label: '调仓频率',
          value: `${frequencyLabel} · ${periods.length} 期`,
          hint: '区间内交易日按频率分组，每组最后一个交易日调仓',
        },
        {
          label: '每期持仓',
          value: `≤${p.topK} 只`,
          hint: '各因子截面分位数等权合成综合分，按综合分取前 K 等权；可入选不足 K 时不补齐',
        },
        {
          label: '业绩基准',
          value: bench.name,
          hint: `指数日收盘对齐组合交易日（数据表 ${INDEX_TABLE}）`,
        },
        {
          label: '交易费用',
          value: p.feeRate > 0 ? `单边 ${(p.feeRate * 100).toFixed(2)}%` : '未计',
          hint: p.feeRate > 0
            ? `每期换手日在组合收益中计提：首期建仓 1×${(p.feeRate * 100).toFixed(2)}%，之后买卖双边 ${(2 * p.feeRate * 100).toFixed(2)}%×单边换手；换手为单边口径（上期持仓 − 两期重叠）÷ 上期持仓`
            : '收益未扣手续费/滑点（feeRate=0）；换手为单边口径（上期持仓 − 两期重叠）÷ 上期持仓',
        },
      ],
      // 可复现配置：前端"保存为我的策略"（API-27）按它请求服务端重跑；结构同 BacktestRunConfig
      config: {
        factors: p.factors,
        startDate: p.startDate,
        endDate: p.endDate,
        frequency: p.frequency,
        ...(p.everyNTd !== undefined ? { everyNTd: p.everyNTd } : {}),
        topK: p.topK,
        benchmark: p.benchmark,
      },
      // 逐点交易日（YYYYMMDD）：前端 x 轴按真实日期打刻度，杜绝"推测日期"
      dates: returnDates,
    };
    const summary = {
      ok: true,
      因子: p.factors.map((f) => `${f.table}.${f.field}${f.order === 'asc' ? '（升序，值小优）' : ''}`).join(' + '),
      区间: `${p.startDate}~${p.endDate}`,
      调仓频率: frequencyLabel,
      调仓期数: periods.length,
      每期持仓上限: p.topK,
      年化收益: formatPct(aggregate.metrics.annual),
      最大回撤: aggregate.metrics.drawdown.toFixed(1) + '%',
      夏普比率: aggregate.metrics.sharpe.toFixed(2),
      胜率: aggregate.metrics.winRate.toFixed(1) + '%',
      年化换手单边: formatPct(aggregate.annualTurnoverPct, 0),
      交易费用: p.feeRate > 0
        ? `单边 ${(p.feeRate * 100).toFixed(2)}%/次，已在每期换手日计提（首期建仓单边、之后双边×换手）`
        : '未计（feeRate=0，收益未扣手续费）',
      基准: `${bench.name} 年化 ${formatPct(aggregate.benchAnnual)}，超额 ${formatPct(aggregate.metrics.annual - aggregate.benchAnnual)}`,
      最后一期持仓示例: periodHoldings[periodHoldings.length - 1].slice(0, 5),
      提示: '回测卡片已生成并将随回复展示；请用不超过 90 字总结以上结果，只能引用返回数字，不要编造，结尾用短句提醒不构成投资建议。',
    };
    this.logger.log(
      `${factorExpr} ${p.startDate}~${p.endDate} ${frequencyLabel}: 期数=${periods.length} ` +
        `年化=${summary.年化收益} 回撤=${summary.最大回撤} 换手=${summary.年化换手单边}`,
    );
    return { card, summary, metrics: aggregate.metrics };
  }

  /** 每年的拉取窗口 [当年首个调仓日, 次年首个调仓日或 endDate]，逐年独立建收盘 Map */
  private async fetchYearlyCloses(
    p: NormalizedBacktestInput,
    rebalanceDates: number[],
    holdings: string[][],
  ): Promise<Map<string, Map<string, number>>> {
    const closes = new Map<string, Map<string, number>>();
    for (let i = 0; i < rebalanceDates.length; ) {
      const year = Math.floor(rebalanceDates[i] / 10000);
      let j = i;
      while (j < rebalanceDates.length && Math.floor(rebalanceDates[j] / 10000) === year) j++;

      const yearCodes = new Set<string>();
      for (let k = i; k < j; k++) for (const code of holdings[k]) yearCodes.add(code);

      const fetchEnd = j < rebalanceDates.length ? rebalanceDates[j] : Number(p.endDate);
      if (rebalanceDates[i] >= fetchEnd) {
        // 起止重合：该年段没有收益日（如最后一个调仓日恰为 endDate），无需拉行情
        i = j;
        continue;
      }
      const rows = await this.factorData.readDailyCloses(
        QUOTE_TABLE,
        [...yearCodes],
        String(rebalanceDates[i]),
        String(fetchEnd),
      );
      for (const row of rows) {
        const code = `${row.ticker}.${row.exchange}`;
        let byDate = closes.get(code);
        if (!byDate) {
          byDate = new Map<string, number>();
          closes.set(code, byDate);
        }
        byDate.set(row.tradeDate, row.closeAdj);
      }
      this.logger.log(`${year} 年持仓并集 ${yearCodes.size} 只，收盘 ${rows.length} 行（至 ${fetchEnd}）`);
      i = j;
    }
    return closes;
  }

  /** 组合某日收益：持仓个股日收益（前复权相邻日相除-1）的等权平均；缺行情按 0 计入分母 */
  private equalWeightDayReturn(
    codes: string[],
    closes: Map<string, Map<string, number>>,
    day: number,
    prev: number | undefined,
  ): number {
    const dayDash = toDashDate(day);
    const prevDash = prev !== undefined ? toDashDate(prev) : undefined;
    let sum = 0;
    for (const code of codes) {
      const byDate = closes.get(code);
      const c1 = byDate?.get(dayDash);
      const c0 = prevDash !== undefined ? byDate?.get(prevDash) : undefined;
      if (c1 !== undefined && c0 !== undefined && c0 > 0) sum += c1 / c0 - 1;
    }
    return codes.length ? sum / codes.length : 0;
  }

  /** 单边换手 = (上期持仓数 - 两期重叠数) / 上期持仓数 */
  private periodTurnover(prev: string[], curr: string[]): number {
    const prevSet = new Set(prev);
    const overlap = curr.filter((c) => prevSet.has(c)).length;
    return prev.length ? (prev.length - overlap) / prev.length : 0;
  }

  private frequencyLabel(p: NormalizedBacktestInput): string {
    return p.frequency === 'custom' ? `每${p.everyNTd}个交易日` : FREQUENCY_LABELS[p.frequency];
  }

  /** 字典白名单：每个因子的表必须在 SQL/tables.md，字段必须在该表 SQL/<表名>.md */
  private assertWhitelist(factors: BacktestFactor[]): void {
    for (const factor of factors) {
      const fields = loadTableFields(factor.table);
      if (fields === undefined) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `表不在字段字典中（SQL/tables.md）: ${factor.table}。可用表: ${listKnownTables().join(', ') || '（无）'}`,
        );
      }
      if (!fields.has(factor.field)) {
        throw new ApiException(
          'INVALID_ARGUMENT',
          400,
          `表 ${factor.table} 无此因子字段（见 SQL/${factor.table}.md）: ${factor.field}`,
        );
      }
    }
  }
}
