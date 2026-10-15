import {
  assertTimingOverlay,
  collectTimingRefs,
  describeTimingOverlay,
  evalTimingCondition,
  exposureOfRegime,
  holdingDaysPct,
  missedRallies,
  nextTimingRegime,
  positionDistribution,
  voteTiming,
} from '../../src/core/timing';

const overlay = assertTimingOverlay({
  rules: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 3000 }],
  bearPositionPct: 0,
})!;

describe('assertTimingOverlay', () => {
  it('未传返回 undefined（不择时）', () => {
    expect(assertTimingOverlay(undefined)).toBeUndefined();
    expect(assertTimingOverlay('')).toBeUndefined();
  });

  it('缺省值：index=sse、votes=-1（全部）、bearPositionPct=0（空仓）', () => {
    const o = assertTimingOverlay({ rules: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 3000 }] })!;
    expect(o.index).toBe('sse');
    expect(o.enterVotes).toBe(-1);
    expect(o.exitVotes).toBe(-1);
    expect(o.bearPositionPct).toBe(0);
  });

  it('非法 op 报错', () => {
    expect(() => assertTimingOverlay({ rules: [{ table: 'mkt_idxd', field: 'F', op: '>=', value: 1 }] })).toThrow(/op 只允许/);
  });

  it('bw 区间 low >= high 报错', () => {
    expect(() =>
      assertTimingOverlay({ rules: [{ table: 'mkt_idxd', field: 'F', op: 'bw', low: 10, high: 5 }] }),
    ).toThrow(/low < high/);
  });

  it('votes 越界报错（只允许 -1 或 1~rules.length）', () => {
    expect(() => assertTimingOverlay({ rules: [{ table: 't', field: 'f', op: '>', value: 1 }], enterVotes: 2 })).toThrow(/enterVotes/);
    expect(() => assertTimingOverlay({ rules: [{ table: 't', field: 'f', op: '>', value: 1 }], exitVotes: 0 })).toThrow(/exitVotes/);
  });

  it('bearPositionPct 越界报错', () => {
    expect(() => assertTimingOverlay({ rules: [{ table: 't', field: 'f', op: '>', value: 1 }], bearPositionPct: 150 })).toThrow(/bearPositionPct/);
  });
});

describe('投票与状态机（果仁语义：双向阈值滞回）', () => {
  it('条件成立=牛票、不成立=熊票、缺值=弃权', () => {
    expect(voteTiming(overlay, [3000])).toEqual({ bull: 0, bear: 1, abstain: 0 }); // 严格大于：3000>3000 为 false
    expect(voteTiming(overlay, [3001])).toEqual({ bull: 1, bear: 0, abstain: 0 });
    expect(voteTiming(overlay, [undefined])).toEqual({ bull: 0, bear: 0, abstain: 1 }); // 缺值弃权
  });

  it('牛状态：熊票未达阈值（-1=需全部）→ 维持牛', () => {
    // 单规则 overlay：1 张熊票就是"全部"，必转熊——用双规则构造未达全部的场景
    const dual = assertTimingOverlay({
      rules: [
        { table: 'mkt_idxd', field: 'CLOSE_INDEX', op: '>', value: 3000 },
        { table: 'mkt_idxd', field: 'TURNOVER_VALUE', op: '>', value: 0 },
      ],
      exitVotes: -1,
      bearPositionPct: 50,
    })!;
    const votes = voteTiming(dual, [2000, 5]); // 规则1 熊票、规则2 牛票 → 未达"全部"
    expect(votes).toEqual({ bull: 1, bear: 1, abstain: 0 });
    expect(nextTimingRegime('bull', votes, dual)).toBe('bull');
  });

  it('牛状态：熊票达到 exitVotes → 转熊；熊状态：牛票达到 enterVotes → 转牛', () => {
    const dual = assertTimingOverlay({
      rules: [
        { table: 'mkt_idxd', field: 'A', op: '>', value: 0 },
        { table: 'mkt_idxd', field: 'B', op: '>', value: 0 },
      ],
      enterVotes: 1,
      exitVotes: 2,
      bearPositionPct: 30,
    })!;
    const bearVotes = voteTiming(dual, [-1, -1]); // 全部熊票
    expect(nextTimingRegime('bull', bearVotes, dual)).toBe('bear');
    const oneBull = voteTiming(dual, [1, -1]); // 1 张牛票 = enterVotes:1 达标
    expect(nextTimingRegime('bear', oneBull, dual)).toBe('bull');
  });

  it('exposureOfRegime：牛市满仓，熊市保留 bearPositionPct', () => {
    expect(exposureOfRegime('bull', overlay)).toBe(100);
    expect(exposureOfRegime('bear', overlay)).toBe(0);
  });
});

describe('describeTimingOverlay（确认门/卡片/摘要同源）', () => {
  it('含指数、规则、双向票数与熊市仓位', () => {
    const text = describeTimingOverlay(overlay);
    expect(text).toContain('上证指数');
    expect(text).toContain('mkt_idxd.CLOSE_INDEX > 3000');
    expect(text).toContain('需全部条件由熊转牛');
    expect(text).toContain('熊市仓位 空仓');
  });

  it('引用集合：去重的 table.field（白名单快检/日历推导用）', () => {
    expect(collectTimingRefs(overlay)).toEqual([{ table: 'mkt_idxd', field: 'CLOSE_INDEX' }]);
  });
});

describe('择时统计三件套', () => {
  it('仓位分布：按 25% 一档计数，0 与 100 单列，空档剔除', () => {
    expect(positionDistribution([100, 100, 60, 0])).toEqual([
      { label: '100%(满仓)', days: 2 },
      { label: '51-75%', days: 1 },
      { label: '0%(空仓)', days: 1 },
    ]);
  });

  it('持股时间占比：暴露>0 的天数占比', () => {
    expect(holdingDaysPct([100, 100, 0, 50])).toBe(75);
  });

  it('踏空归因：只收暴露不足日的 Top 涨幅，按涨幅降序', () => {
    const rows = missedRallies(
      [0.01, 0.09, 0.05, 0.07],
      [20240102, 20240103, 20240104, 20240105],
      [100, 0, 0, 100],
      10,
      50,
    );
    // 暴露 <50% 的两日（9%、5%）入选，按涨幅降序；满仓两日不计
    expect(rows).toEqual([
      { date: 20240103, pct: 9, exposure: 0 },
      { date: 20240104, pct: 5, exposure: 0 },
    ]);
  });
});
