import { ApiException } from '../../../src/common/api.exception';
import {
  aggregatePerformance,
  assertBacktestInput,
  BacktestFactor,
  compositeTopK,
  EqualWeightBacktestInput,
  ClarificationSignal,
  groupRebalanceDates,
} from '../../../src/core/equal-weight-backtest.service';
import {
  CrossSectionRow,
  DailyCloseRow,
  FactorDataService,
  IndexDailyRow,
} from '../../../src/core/factor-data.service';
import { EqualWeightBacktestServiceImpl } from '../../../src/core/implementations/equal-weight-backtest.service.impl';

/* ==========================================================
   等权回测单元测试（不触库）
   - assertBacktestInput：factors 数组 + frequency 必填无默认 + 各参数校验
   - compositeTopK：多因子截面分位数等权合成（含 asc 反向、部分覆盖）
   - groupRebalanceDates：8 档调仓频率的分组口径
   - aggregatePerformance：净值/指标/年化换手聚合
   - EqualWeightBacktestServiceImpl：stub FactorDataService 走全流程
     （双因子合成选股 → 逐年拉数 → 日收益/换手 → 卡片+摘要，含跨年拉取窗口）
   ========================================================== */

/** 期望 ApiException 的断言 */
const expectApiError = (run: () => unknown, messagePart: string) => {
  let caught: unknown;
  try {
    caught = run();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(ApiException);
  expect((caught as ApiException).code).toBe('INVALID_ARGUMENT');
  expect((caught as ApiException).message).toContain(messagePart);
};

/** 合法入参基线（双因子、方向相反；EBIT/EBITDA 均为 equ_factor_derive 真实字典字段），用例按需覆写 */
const baseInput = (patch: Partial<EqualWeightBacktestInput> = {}): EqualWeightBacktestInput => ({
  factors: [
    { table: 'equ_factor_derive', field: 'EBIT' },
    { table: 'equ_factor_derive', field: 'EBITDA', order: 'asc' },
  ],
  startDate: '20240102',
  endDate: '20240329',
  frequency: 'monthly',
  ...patch,
});

/** 合成交易日：自然日过滤周末，YYYYMMDD 升序 */
function businessDays(startISO: string, endISO: string): number[] {
  const out: number[] = [];
  const d = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  while (d <= end) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) {
      out.push(d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate());
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** 快速造截面：{代码尾号: 值} → CrossSectionRow[]（00000X.XSHE） */
function section(values: Record<string, number>): CrossSectionRow[] {
  return Object.entries(values).map(([tail, value]) => ({ securityId: `00000${tail}.XSHE`, value }));
}

/** YYYYMMDD → 'YYYY-MM-DD'（与契约一致：readDailyCloses/readIndexDaily 收纯数字日期） */
const dash = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

describe('assertBacktestInput（入参归一化校验）', () => {
  it('frequency 缺失 / null / 空串 → 抛 ClarificationSignal（自带澄清指引，非入参错误）', () => {
    const { frequency: _f, ...without } = baseInput();
    expect(() => assertBacktestInput(without)).toThrow(ClarificationSignal);
    expect(() => assertBacktestInput(baseInput({ frequency: null }))).toThrow(ClarificationSignal);
    expect(() => assertBacktestInput(baseInput({ frequency: '' }))).toThrow(ClarificationSignal);
  });

  it('frequency=daily（日频）→ 合法归一化（引擎 8 档已含日频）', () => {
    expect(assertBacktestInput(baseInput({ frequency: 'daily' })).frequency).toBe('daily');
  });

  it('frequency 非法枚举 → 报错并提示可选值', () => {
    expectApiError(() => assertBacktestInput(baseInput({ frequency: '每两周' })), 'frequency 非法');
    expectApiError(() => assertBacktestInput(baseInput({ frequency: 'hourly' })), 'frequency 非法');
  });

  it('factors 缺失 / 空数组 / 超上限 / 项缺字段 / 方向非法 → 各自报错', () => {
    const { factors: _x, ...noFactors } = baseInput();
    expectApiError(() => assertBacktestInput(noFactors), '需要 factors');
    expectApiError(() => assertBacktestInput(baseInput({ factors: [] })), '需要 factors');
    expectApiError(
      () =>
        assertBacktestInput(
          baseInput({ factors: Array.from({ length: 11 }, () => ({ table: 'equ_factor_derive', field: 'EBIT' })) }),
        ),
      '最多 10 个',
    );
    expectApiError(() => assertBacktestInput(baseInput({ factors: [{ table: 'equ_factor_derive' }] })), '每项都需要 table 与 field');
    expectApiError(
      () => assertBacktestInput(baseInput({ factors: [{ table: 'equ_factor_derive', field: 'EBIT', order: 'up' }] })),
      'order 只允许',
    );
  });

  it('区间非法 / topK / benchmark 非法 → 各自报错；重复因子自动去重', () => {
    expectApiError(() => assertBacktestInput(baseInput({ startDate: '2024-01-02' })), '区间非法');
    expectApiError(() => assertBacktestInput(baseInput({ endDate: '20230101' })), '区间非法');
    expectApiError(() => assertBacktestInput(baseInput({ topK: 0 })), 'topK 必须是');
    expectApiError(() => assertBacktestInput(baseInput({ benchmark: 'sp500' })), 'benchmark 只允许');
    const p = assertBacktestInput(
      baseInput({
        factors: [
          { table: 'equ_factor_derive', field: 'EBIT' },
          { table: 'equ_factor_derive', field: 'EBIT', order: 'asc' }, // 同表同字段视为重复（先到先得）
          { table: 'equ_factor_derive', field: 'ROC' },
        ],
      }),
    );
    expect(p.factors).toHaveLength(2);
  });

  it('合法入参 → 归一化（order 缺省 desc、topK 50、benchmark hs300）', () => {
    const p = assertBacktestInput(baseInput());
    expect(p.factors).toEqual([
      { table: 'equ_factor_derive', field: 'EBIT', order: 'desc' },
      { table: 'equ_factor_derive', field: 'EBITDA', order: 'asc' },
    ]);
    expect(p).toMatchObject({ frequency: 'monthly', topK: 50, benchmark: 'hs300' });
    expect(p.everyNTd).toBeUndefined();
  });
});

describe('compositeTopK（多因子等权合成）', () => {
  const desc = (table: string, field: string): BacktestFactor => ({ table, field, order: 'desc' });
  const asc = (table: string, field: string): BacktestFactor => ({ table, field, order: 'asc' });

  it('单因子 desc：值越大分位越高', () => {
    const factors = [desc('t', 'A')];
    const sections = [section({ 1: 1, 2: 3, 3: 2 })];
    expect(compositeTopK(factors, sections, 2)).toEqual(['000002.XSHE', '000003.XSHE']);
  });

  it('单因子 asc：值越小分位越高（低估值口径）', () => {
    const factors = [asc('t', 'A')];
    const sections = [section({ 1: 1, 2: 3, 3: 2 })];
    expect(compositeTopK(factors, sections, 3)).toEqual(['000001.XSHE', '000003.XSHE', '000002.XSHE']);
  });

  it('双因子等权：desc A + asc B，综合分 = 两因子分位均值', () => {
    const factors = [desc('t', 'A'), asc('t', 'B')];
    // A desc 分位：2→1、3→2/3、1→1/3；B asc 分位：1→0、2→2/3、3→1/3
    const sections = [section({ 1: 1, 2: 3, 3: 2 }), section({ 1: 10, 2: 5, 3: 8 })];
    // 综合：2→5/6、3→1/2、1→1/6
    expect(compositeTopK(factors, sections, 2)).toEqual(['000002.XSHE', '000003.XSHE']);
  });

  it('部分覆盖：缺某因子的股票按可得因子均值参与排名', () => {
    const factors = [desc('t', 'A'), asc('t', 'B')];
    const sections = [section({ 1: 1, 2: 3, 3: 2 }), section({ 1: 5 })]; // 代码 2、3 无 B 因子
    // 1：A 1/3、B asc 反向 0 → 1/6；2：A 1 → 1；3：A 2/3 → 2/3
    expect(compositeTopK(factors, sections, 3)).toEqual(['000002.XSHE', '000003.XSHE', '000001.XSHE']);
  });

  it('兜底：截面可入选股票数不足 topK → 有几只选几只（不足不报错、不补齐）', () => {
    const factors = [desc('t', 'A')];
    const sections = [section({ 1: 1, 2: 3, 3: 2 })];
    // k=5 但截面只有 3 只 → 全取 3 只，按综合分降序
    expect(compositeTopK(factors, sections, 5)).toEqual(['000002.XSHE', '000003.XSHE', '000001.XSHE']);
  });

  it('某因子截面全空 → 只按其余因子合成，不报错', () => {
    const factors = [desc('t', 'A'), asc('t', 'B')];
    const sections = [section({ 1: 1, 2: 3 }), []];
    expect(compositeTopK(factors, sections, 1)).toEqual(['000002.XSHE']);
  });
});

describe('groupRebalanceDates（调仓日分组）', () => {
  const jan = businessDays('2024-01-02', '2024-01-31');
  const feb = businessDays('2024-02-01', '2024-02-29');
  const dates = [...jan, ...feb];

  it('monthly：每月最后交易日', () => {
    expect(groupRebalanceDates(dates, 'monthly')).toEqual([20240131, 20240229]);
  });

  it('weekly：每周最后交易日（周五；末尾残周取其最后一天）', () => {
    // 前 10 个交易日：1/2~1/5、1/8~1/12、1/15 → 第 3 周只有周一，取 1/15
    expect(groupRebalanceDates(jan.slice(0, 10), 'weekly')).toEqual([20240105, 20240112, 20240115]);
  });

  it('biweekly：15 日（含）前与月末各一期', () => {
    expect(groupRebalanceDates(dates, 'biweekly')).toEqual([20240115, 20240131, 20240215, 20240229]);
  });

  it('quarterly / semiannual / annual：周期末日', () => {
    const year = businessDays('2024-01-02', '2024-12-31');
    expect(groupRebalanceDates(year, 'quarterly')).toContain(20240329);
    expect(groupRebalanceDates(year, 'quarterly')).toContain(20241231);
    expect(groupRebalanceDates(year, 'semiannual')).toEqual([20240628, 20241231]);
    expect(groupRebalanceDates(year, 'annual')).toEqual([20241231]);
  });

  it('custom everyNTd=10：每 10 个交易日取第 10、20…个', () => {
    const out = groupRebalanceDates(jan, 'custom', 10);
    expect(out).toEqual([jan[9], jan[19], jan[21]]);
  });

  it('空序列 → 空数组', () => {
    expect(groupRebalanceDates([], 'monthly')).toEqual([]);
  });
});

describe('aggregatePerformance（绩效聚合）', () => {
  it('净值复利、胜率、回撤与年化换手', () => {
    const returns = [0.01, -0.005, 0.02];
    const benchReturns = [0.005, 0.005, 0.005];
    const agg = aggregatePerformance(returns, benchReturns, [0.5, 0.25], 12);
    expect(agg.curve).toEqual([101, 100.5, 102.5]);
    expect(agg.benchCurve.length).toBe(3);
    expect(agg.metrics.winRate).toBeCloseTo(66.67, 1);
    expect(agg.metrics.drawdown).toBeLessThanOrEqual(0);
    expect(agg.annualTurnoverPct).toBeCloseTo(450, 0);
    expect(agg.metrics.annual).toBeGreaterThan(0);
    expect(agg.benchAnnual).toBeGreaterThan(0);
  });
});

describe('EqualWeightBacktestServiceImpl（全流程 stub，不触库）', () => {
  /** 组装 stub 取数服务：2024Q1 月度调仓 3 期，双因子等权合成、两期部分轮换产生换手 0.5/0 */
  const makeService = () => {
    const dates = businessDays('2024-01-02', '2024-03-29');
    const rebalances = [20240131, 20240229, 20240329];
    // 截面设计（EBIT desc + ROC asc），综合分排名：
    //   d1: 2(5/6) > 3(1/2) > 1(1/6) → 持仓 [2,3]
    //   d2/d3: 1(5/6) > 2(1/2) > 3(1/6) → 持仓 [1,2]（换手 0.5，再 0）
    const ebit: Record<string, Record<string, number>> = {
      20240131: { 1: 1, 2: 3, 3: 2 },
      20240229: { 1: 3, 2: 2, 3: 1 },
      20240329: { 1: 3, 2: 2, 3: 1 },
    };
    const roc: Record<string, Record<string, number>> = {
      20240131: { 1: 10, 2: 5, 3: 8 },
      20240229: { 1: 5, 2: 8, 3: 10 },
      20240329: { 1: 5, 2: 8, 3: 10 },
    };
    const calls = { dailyCloses: [] as { start: string; end: string; codes: string[] }[] };
    const stub = {
      readTable: jest.fn(),
      readTradeDates: jest.fn().mockResolvedValue({ dates, min: 20210506, max: 20260918 }),
      readCrossSection: jest.fn().mockImplementation((_t: string, field: string, date: string) => {
        const source = field === 'EBIT' ? ebit : roc;
        return Promise.resolve(section(source[Number(date)] ?? {}));
      }),
      readDailyCloses: jest.fn().mockImplementation((_t: string, codes: string[], start: string, end: string) => {
        calls.dailyCloses.push({ start, end, codes: [...codes] });
        const rows: DailyCloseRow[] = [];
        const window = businessDays(dash(start), dash(end));
        for (const code of codes) {
          for (let i = 0; i < window.length; i++) {
            rows.push({ ticker: code.split('.')[0], exchange: code.split('.')[1], tradeDate: dash(String(window[i])), closeAdj: 100 + i });
          }
        }
        return Promise.resolve(rows);
      }),
      readIndexDaily: jest.fn().mockImplementation((_t: string, _ticker: string, start: string, end: string) => {
        const rows: IndexDailyRow[] = [];
        const window = businessDays(dash(start), dash(end));
        for (let i = 0; i < window.length; i++) {
          rows.push({ tradeDate: dash(String(window[i])), close: 4000 + i, preClose: i === 0 ? 4000 : 4000 + i - 1 });
        }
        return Promise.resolve(rows);
      }),
    };
    const service = new EqualWeightBacktestServiceImpl(stub as unknown as FactorDataService);
    return { service, calls };
  };

  it('2024Q1 双因子月度：3 期、合成排名正确、卡片 5 项指标', async () => {
    const { service } = makeService();
    // topK=2：截面仅 3 只，取综合分前 2 → 两期轮换产生换手 0.5/0
    const { card, summary } = await service.runEqualWeightBacktest(baseInput({ topK: 2 }));

    expect(card.type).toBe('backtest');
    expect(card.tag).toBe('等权回测·每月');
    expect(card.title).toContain('EBIT + EBITDA');
    expect(card.note).toContain('截面分位数等权合成');
    expect(card.metrics.map((m) => m.label)).toEqual(['年化收益', '最大回撤', '夏普比率', '胜率', '年化换手(单边)']);
    expect(card.benchName).toBe('沪深300');

    // 卡片携带本次回测真实参数（前端"回测参数"块按卡片渲染，不显示策略页配置项）
    const labels = card.params?.map((p) => p.label) ?? [];
    expect(labels).toEqual(['回测区间', '调仓频率', '每期持仓', '业绩基准', '交易费用']);
    const byLabel = Object.fromEntries((card.params ?? []).map((p) => [p.label, p]));
    expect(byLabel['回测区间']?.value).toBe('2024-01-02 ~ 2024-03-29'); // baseInput 区间转短横线日期
    expect(byLabel['调仓频率']?.value).toBe('每月 · 3 期');
    expect(byLabel['每期持仓']?.value).toBe('≤2 只');
    expect(byLabel['业绩基准']?.value).toBe('沪深300');
    expect(byLabel['交易费用']?.value).toBe('未计');

    expect(summary.调仓期数).toBe(3);
    expect(summary.因子).toContain('EBIT');
    expect(summary.因子).toContain('EBITDA（升序，值小优）');
    expect(summary.胜率).toBe('100.0%');
    // 最后一期（d3）综合分排名：1 > 2 > 3 → 前 2 只
    expect(summary.最后一期持仓示例).toEqual(['000001.XSHE', '000002.XSHE']); // 末期综合分 1 > 2 > 3，取前 2
    // 平均换手 (0.5+0)/2 = 0.25，年化 = 0.25 × (3期 / (日收益数/252)) × 100
    const days = card.curve.length;
    const expectedTurnover = 0.25 * (3 / (days / 252)) * 100;
    expect(parseFloat(String(card.metrics[4].value).replace('%', ''))).toBeCloseTo(expectedTurnover, -1);
  });

  it('兜底：topK=5 但每期截面只有 3 只 → 每期全取 3 只等权，不报错', async () => {
    const { service } = makeService();
    const { card, summary } = await service.runEqualWeightBacktest(baseInput({ topK: 5 }));
    // 每期可入选只有 3 只（< topK）→ 有几只选几只；持仓三期相同 → 换手 0
    expect(summary.最后一期持仓示例).toHaveLength(3);
    expect(summary.年化换手单边).toBe('0%');
    expect(summary.调仓期数).toBe(3);
    expect(card.curve.length).toBeGreaterThan(0);
  });

  it('逐年拉取窗口：2023-12~2024-01 月度调仓，跨年段以次年首个调仓日收口', async () => {
    const dec = businessDays('2023-12-01', '2023-12-29');
    const jan = businessDays('2024-01-02', '2024-01-31');
    const dates = [...dec, ...jan];
    const calls = { windows: [] as string[][] };
    const stub = {
      readTable: jest.fn(),
      readTradeDates: jest.fn().mockResolvedValue({ dates, min: 20210506, max: 20260918 }),
      readCrossSection: jest.fn().mockImplementation((_t: string, _f: string, date: string) => {
        // 单因子（基线无 ROC 时只用 EBIT）；两期截面不同 → 两期持仓不同
        return Promise.resolve(Number(date) === 20231229 ? section({ 1: 1, 2: 2 }) : section({ 2: 2, 3: 3 }));
      }),
      readDailyCloses: jest.fn().mockImplementation((_t: string, codes: string[], start: string, end: string) => {
        calls.windows.push([start, end]);
        return Promise.resolve([]);
      }),
      readIndexDaily: jest.fn().mockResolvedValue([]),
    };
    const service = new EqualWeightBacktestServiceImpl(stub as unknown as FactorDataService);
    await service.runEqualWeightBacktest(
      baseInput({
        factors: [{ table: 'equ_factor_derive', field: 'EBIT' }],
        startDate: '20231201',
        endDate: '20240131',
        frequency: 'monthly',
      }),
    );

    // 2023 年窗口：[首个调仓日 20231229, 次年首个调仓日 20240131]（跨年段，契约日期为纯数字）
    expect(calls.windows[0]).toEqual(['20231229', '20240131']);
    // 持仓并集只含 2023 年内开始的调仓期（12-29 那期）的两只
    expect(stub.readDailyCloses.mock.calls[0][1]).toEqual(['000002.XSHE', '000001.XSHE']) // 按综合分降序：000002 分位更高;
    // 2024 年窗口起止重合（01-31 调仓恰为 endDate，该期无收益日）→ 跳过拉取
    expect(calls.windows.length).toBe(1);
  });

  it('缺 frequency → 抛澄清信号（不触库），非法枚举才是入参错误', async () => {
    const { service } = makeService();
    const { frequency: _f, ...without } = baseInput();
    await expect(service.runEqualWeightBacktest(without)).rejects.toBeInstanceOf(ClarificationSignal);
    await expect(service.runEqualWeightBacktest(baseInput({ frequency: 'hourly' }))).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('调仓期数不足 → 报错', async () => {
    const { service } = makeService();
    await expect(
      service.runEqualWeightBacktest(baseInput({ startDate: '20240102', endDate: '20240115', frequency: 'quarterly' })),
    ).rejects.toThrow('调仓期数不足');
  });

  it('因子表/字段白名单在触库前校验：不在字典 → 拒绝', async () => {
    const { service } = makeService();
    await expect(
      service.runEqualWeightBacktest(baseInput({ factors: [{ table: 'md_security', field: 'X' }] })),
    ).rejects.toThrow('表不在字段字典中');
    await expect(
      service.runEqualWeightBacktest(baseInput({ factors: [{ table: 'equ_factor_derive', field: 'NoSuchFactor' }] })),
    ).rejects.toThrow('无此因子字段');
  });

  it('区间超出数据范围 → 报错并提示可用区间', async () => {
    const { service } = makeService();
    await expect(
      service.runEqualWeightBacktest(baseInput({ startDate: '20190101', endDate: '20240329' })),
    ).rejects.toThrow('超出数据范围');
  });
});
