import { subsetMatch } from './match';

describe('subsetMatch（期望参数子集匹配）', () => {
  it('对象：期望键全中即过，实际多出的键不判负', () => {
    const actual = { startDate: '20230101', endDate: '20231231', rebalanceIntervalDays: 21, extra: 'x' };
    expect(subsetMatch(actual, { rebalanceIntervalDays: 21 })).toBe(true);
    expect(subsetMatch(actual, { rebalanceIntervalDays: 10 })).toBe(false);
    expect(subsetMatch(actual, { notThere: 1 })).toBe(false);
  });

  it('标量宽松：数字期望 vs 字符串实际等价', () => {
    expect(subsetMatch({ a: '21' }, { a: 21 })).toBe(true);
    expect(subsetMatch({ a: 0.0005 }, { a: '0.0005' })).toBe(true);
  });

  it('数组：期望项逐个在场即可，不比顺序与长度', () => {
    const sort = [
      { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
      { table: 'equ_factor_obos', field: 'ATR14', direction: -1 },
    ];
    expect(subsetMatch(sort, [{ field: 'ATR14', direction: -1 }])).toBe(true);
    expect(subsetMatch(sort, [{ field: 'REVS20', direction: 1 }, { field: 'ATR14', direction: -1 }])).toBe(true);
    expect(subsetMatch(sort, [{ field: 'REVS20', direction: -1 }])).toBe(false);
    expect(subsetMatch(sort, [{ field: 'NOT_EXIST' }])).toBe(false);
  });

  it('标记：$type 与 $contains', () => {
    expect(subsetMatch({ poolId: 'pabc123' }, { poolId: { $type: 'string' } })).toBe(true);
    expect(subsetMatch({ poolId: 42 }, { poolId: { $type: 'string' } })).toBe(false);
    expect(subsetMatch({ content: '以后都用万三手续费' }, { content: { $contains: '万三' } })).toBe(true);
    expect(subsetMatch({ timingOverlay: { a: 1 } }, { timingOverlay: { $type: 'object' } })).toBe(true);
  });

  it('undefined 期望：仅当实际也是 undefined', () => {
    expect(subsetMatch({}, { sortFactors: undefined })).toBe(true);
    expect(subsetMatch({ sortFactors: [] }, { sortFactors: undefined })).toBe(false);
  });

  it('嵌套：对象内数组内对象', () => {
    const actual = { entryFilters: [{ table: 'mkt_idxd', field: 'CLOSE_INDEX', op: 'gt', value: 3000 }] };
    expect(subsetMatch(actual, { entryFilters: [{ field: 'CLOSE_INDEX', op: 'gt' }] })).toBe(true);
    expect(subsetMatch(actual, { entryFilters: [{ field: 'CHG_PCT' }] })).toBe(false);
  });
});
