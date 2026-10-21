import { assertPoolGroups, describePoolSpec, INDEX_NAMES } from '../../src/core/industry-engine';
import { ApiException } from '../../src/common/api.exception';

/* ==========================================================
   池规格纯函数（ADR-0006）：入参校验归一与展示摘要。
   不触 DuckDB——解析（resolvePoolSpec）走真库，由 industry-engine.spec 集成覆盖。
   ========================================================== */

describe('assertPoolGroups（筛选组校验归一）', () => {
  it('三种 kind 合法形态：去重、trim、保留类型', () => {
    const groups = assertPoolGroups([
      { kind: 'industry', names: [' 有色金属 ', '食品饮料', '食品饮料'] },
      { kind: 'index', codes: ['000300.SH'] },
      { kind: 'list', ids: ['000002.XSHE', ''] },
    ]);
    expect(groups).toEqual([
      { kind: 'industry', names: ['有色金属', '食品饮料'] },
      { kind: 'index', codes: ['000300.SH'] },
      { kind: 'list', ids: ['000002.XSHE'] },
    ]);
  });

  it('空数组/缺参 → 400；未知 kind → 400；组内空清单 → 400', () => {
    expect(() => assertPoolGroups([])).toThrow(ApiException);
    expect(() => assertPoolGroups(undefined)).toThrow(ApiException);
    expect(() => assertPoolGroups([{ kind: 'board', names: ['x'] }])).toThrow(/kind/);
    expect(() => assertPoolGroups([{ kind: 'industry', names: [] }])).toThrow(/names/);
    expect(() => assertPoolGroups([{ kind: 'index' }])).toThrow(/codes/);
    expect(() => assertPoolGroups([{ kind: 'list', ids: ['', '  '] }])).toThrow(/ids/);
  });
});

describe('describePoolSpec（筛选摘要：组内 ∪、组间 ∩）', () => {
  it('行业名/指数中文名/点名清单三来源组合', () => {
    const summary = describePoolSpec([
      { kind: 'industry', names: ['有色金属', '黄金'.replace('黄金', '钢铁')] },
      { kind: 'index', codes: ['000300.SH', '000905.SH'] },
      { kind: 'list', ids: ['a', 'b', 'c'] },
    ]);
    expect(summary).toBe('有色金属∪钢铁∩沪深300∪中证500∩点名3只');
    expect(INDEX_NAMES['000300.SH']).toBe('沪深300');
  });

  it('未登记中文名的指数代码原样展示', () => {
    expect(describePoolSpec([{ kind: 'index', codes: ['980017.CSI'] }])).toBe('980017.CSI');
  });
});
