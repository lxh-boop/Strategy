import {
  FactorAnalysisServiceImpl,
} from '../../../src/core/implementations/factor-analysis.service.impl';
import {
  monotonicityR2,
  segmentCrossSection,
  spearmanOnCrossSection,
} from '../../../src/core/factor-analysis.service';
import { FactorDataService, QuoteRow } from '../../../src/core/factor-data.service';

/* ==========================================================
   因子分析（排名分析 + 相关性矩阵）单元测试：纯函数 + 全流程 stub 不触库
   ========================================================== */

describe('spearmanOnCrossSection（秩相关纯函数）', () => {
  it('完美同向 = 1 / 完美反向 = -1', () => {
    const x = new Map([['A', 4], ['B', 3], ['C', 2], ['D', 1]]);
    const yUp = new Map([['A', 0.2], ['B', 0.1], ['C', -0.1], ['D', -0.2]]);
    const yDown = new Map([['A', -0.2], ['B', -0.1], ['C', 0.1], ['D', 0.2]]);
    expect(spearmanOnCrossSection(x, yUp)).toBe(1);
    expect(spearmanOnCrossSection(x, yDown)).toBe(-1);
  });

  it('并列取平均秩；缺值/非有限剔除；有效对 <2 返回 undefined', () => {
    // A/B 因子值并列 5（秩同取 2.5），收益也相同 → 完全共线含并列仍为 1
    const x = new Map([['A', 5], ['B', 5], ['C', 1]]);
    const y = new Map([['A', 0.1], ['B', 0.1], ['C', -0.1]]);
    expect(spearmanOnCrossSection(x, y)).toBe(1);
    // C 侧缺收益 → 只剩 1 对 → undefined
    expect(spearmanOnCrossSection(new Map([['A', 1], ['B', 2]]), new Map([['A', 0.1]]))).toBeUndefined();
    // 全并列（方差 0）→ undefined
    const flat = new Map([['A', 7], ['B', 7]]);
    expect(spearmanOnCrossSection(flat, new Map([['A', 1], ['B', 2]]))).toBeUndefined();
  });
});

describe('segmentCrossSection / monotonicityR2', () => {
  it('方向 1：段 1 = 高值段；余数摊给前面的段（5 只分 2 段 = 3+2）', () => {
    const values = new Map([['A', 4], ['B', 3], ['C', 2], ['D', 1], ['E', 0]]);
    expect(segmentCrossSection(values, 1, 2)).toEqual([['A', 'B', 'C'], ['D', 'E']]);
    expect(segmentCrossSection(values, -1, 2)).toEqual([['E', 'D', 'C'], ['B', 'A']]);
  });

  it('空截面 → 全空段', () => {
    expect(segmentCrossSection(new Map(), 1, 3)).toEqual([[], [], []]);
  });

  it('单调性：完美单调 = 1，乱序 < 1，单段 = 0', () => {
    expect(monotonicityR2([4, 3, 2, 1])).toBe(1);
    expect(monotonicityR2([1, 2, 3, 4])).toBe(1); // 完美反向也是完全可排序
    expect(monotonicityR2([4, 1, 3, 2])).toBeLessThan(1);
    expect(monotonicityR2([5])).toBe(0);
  });
});

/* ----- 全流程 stub：两期截面 + 行情面板，不触库 ----- */

const DATES = [20240102, 20240103, 20240104, 20240105, 20240108, 20240109];
const CODES = ['000001.XSHE', '000002.XSHE', '600000.XSHG', '600519.XSHG'];

function makeService(
  sections: Record<string, Record<string, number>>,
  closes: Record<string, Record<number, number>>,
): FactorAnalysisServiceImpl {
  const factorData = {
    readTable: async () => [],
    readTradeDates: async () => ({ dates: DATES, min: 20240101, max: 20241231 }),
    readFactorSection: async (_table: string, _field: string, date: string) => {
      const day = Number(date.replaceAll('-', ''));
      const sec = sections[day] ?? {};
      return Object.entries(sec).map(([securityId, value]) => ({ securityId, value }));
    },
    readFactorRange: async () => [],
    readQuoteSeries: async (codes: string[]) => {
      const rows: QuoteRow[] = [];
      for (const code of codes) {
        const [ticker, exchange] = code.split('.');
        for (const day of DATES) {
          const close = closes[code]?.[day];
          if (close === undefined) continue;
          const s = String(day);
          rows.push({
            ticker, exchange,
            tradeDate: `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`,
            open: close, close, preClose: close,
          });
        }
      }
      return rows;
    },
    readIndexDaily: async () => [],
    readIndexFieldSeries: async () => [],
  } as unknown as FactorDataService;
  return new FactorAnalysisServiceImpl(factorData);
}

/** 因子值 A>B>C>D（direction=1），下期收益同样 A>B>C>D → 完美正相关 */
const SECTIONS = {
  20240102: { '000001.XSHE': 4, '000002.XSHE': 3, '600000.XSHG': 2, '600519.XSHG': 1 },
  20240105: { '000001.XSHE': 4.5, '000002.XSHE': 3.2, '600000.XSHG': 1.8, '600519.XSHG': 0.9 },
};
const CLOSES = {
  '000001.XSHE': { 20240102: 10, 20240105: 12 },  // +20%
  '000002.XSHE': { 20240102: 10, 20240105: 11 },  // +10%
  '600000.XSHG': { 20240102: 10, 20240105: 9 },   // -10%
  '600519.XSHG': { 20240102: 10, 20240105: 8 },   // -20%
};

describe('FactorAnalysisServiceImpl（排名分析，全流程 stub）', () => {
  it('个股级 IC + 分段等权收益：完美有效因子 → IC=1、段收益单调、多空 30%', async () => {
    const svc = makeService(SECTIONS, CLOSES);
    const out = await svc.runRankAnalysis({
      sortFactor: { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
      securityIds: CODES,
      segmentCount: 2,
      intervalDays: 3,
      startDate: '20240101',
      endDate: '20240131',
    });
    // 采样期 0102/0105（每 3 个交易日），期对 1 个
    expect(out.periodCount).toBe(1);
    expect(out.icSeries).toEqual([{ date: 20240102, ic: 1 }]);
    expect(out.icMean).toBe(1);
    expect(out.icPositiveProb).toBe(100);
    expect(out.icIR).toBeUndefined(); // 单期 std=0
    // 段 1 = [A,B] 等权 (20%+10%)/2 = 15%；段 2 = [C,D] = -15%
    expect(out.segmentMeanReturnPct).toEqual([15, -15]);
    expect(out.segmentCumulativePct).toEqual([15, -15]);
    expect(out.monotonicityR2).toBe(1);
    expect(out.longShortSpreadPct).toBe(30);
  });

  it('护栏：分段数越界 → INVALID_ARGUMENT', async () => {
    const svc = makeService(SECTIONS, CLOSES);
    await expect(
      svc.runRankAnalysis({
        sortFactor: { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
        securityIds: CODES, segmentCount: 11, intervalDays: 3,
        startDate: '20240101', endDate: '20240131',
      }),
    ).rejects.toThrow(/segmentCount/);
  });

  it('护栏：期数不足（区间太短）→ INVALID_ARGUMENT', async () => {
    const svc = makeService(SECTIONS, CLOSES);
    await expect(
      svc.runRankAnalysis({
        sortFactor: { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
        securityIds: CODES, segmentCount: 2, intervalDays: 250,
        startDate: '20240101', endDate: '20240131',
      }),
    ).rejects.toThrow(/分析期数不足/);
  });
});

describe('FactorAnalysisServiceImpl（相关性矩阵，全流程 stub）', () => {
  it('两因子同序 → 矩阵对角 1、非对角=均值秩相关；periodCount=采样期数', async () => {
    const svc = makeService(
      {
        20240102: { '000001.XSHE': 4, '000002.XSHE': 3, '600000.XSHG': 2, '600519.XSHG': 1 },
        20240105: { '000001.XSHE': 40, '000002.XSHE': 30, '600000.XSHG': 20, '600519.XSHG': 10 },
      },
      {},
    );
    const out = await svc.runFactorCorrelation({
      refs: [
        { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
        { table: 'equ_factor_obos', field: 'REVS5', direction: 1 },
      ],
      securityIds: CODES,
      intervalDays: 3,
      startDate: '20240101',
      endDate: '20240131',
    });
    expect(out.factors).toEqual(['equ_factor_obos.REVS20', 'equ_factor_obos.REVS5']);
    expect(out.periodCount).toBe(2);
    expect(out.matrix[0][0]).toBe(1);
    expect(out.matrix[1][1]).toBe(1);
    expect(out.matrix[0][1]).toBe(1);
    expect(out.matrix[1][0]).toBe(1);
  });

  it('护栏：因子重复 → INVALID_ARGUMENT', async () => {
    const svc = makeService({}, {});
    await expect(
      svc.runFactorCorrelation({
        refs: [
          { table: 't', field: 'f', direction: 1 },
          { table: 't', field: 'f', direction: -1 },
        ],
        intervalDays: 5,
        startDate: '20240101', endDate: '20240131',
      }),
    ).rejects.toThrow(/因子重复/);
  });
});
