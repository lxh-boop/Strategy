import { ApiException } from '../../src/common/api.exception';
import { ClarificationSignal } from '../../src/core/strategy-backtest.service';
import {
  buildProportions,
  describeFunctions,
  formatFnCall,
  resolvePositionFn,
  resolveWeightFn,
  spearman,
  validatePositionAmounts,
} from '../../src/core/weight-functions';

/* ==========================================================
   权重/仓位统一函数字典单元测试：对位宽容 / 解析与校验 / 信号函数 / 校验器
   ========================================================== */

describe('buildProportions（对位宽容规则）', () => {
  it('缺省 → 等权 1/N', () => {
    expect(buildProportions(undefined, 4)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });
  it('短于条目数 → 剩余条目平分剩余比例', () => {
    const r = buildProportions([0.6], 3);
    expect(r[0]).toBeCloseTo(0.6);
    expect(r[1]).toBeCloseTo(0.2);
    expect(r[2]).toBeCloseTo(0.2);
  });
  it('长于条目数 → 截断', () => {
    expect(buildProportions([0.5, 0.5, 99], 2)).toEqual([0.5, 0.5]);
  });
  it('总和 >1 → 归一到 1', () => {
    const r = buildProportions([1, 1, 1], 3);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it('负值/非法丢弃', () => {
    const r = buildProportions([-1, Number.NaN, 0.4, 0.6], 2);
    expect(r).toEqual([0.4, 0.6]);
  });
});

describe('spearman（秩相关）', () => {
  it('完全单调 → 1；反向 → -1', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  });
  it('成对缺值过滤；样本 <3 → 0', () => {
    expect(spearman([1, undefined, 3, 4], [10, 99, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2], [10, 20])).toBe(0);
  });
});

describe('resolveWeightFn / 仓位解析（字典与校验）', () => {
  it('缺省引用 → constant_weights 等权', () => {
    const b = resolveWeightFn(undefined);
    const w = b.fn({ factors: [
      { table: 't', field: 'a', direction: 1 },
      { table: 't', field: 'b', direction: 1 },
    ], sections: [], pool: [], count: 2 });
    expect(w).toEqual([0.5, 0.5]);
  });
  it('未知函数名 → 400 附名录', () => {
    try {
      resolveWeightFn({ name: 'nope' });
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiException);
      expect((e as ApiException).message).toContain('可用名录');
    }
  });
  it('kind 引错（仓位函数当权重函数）→ 400', () => {
    expect(() => resolveWeightFn({ name: 'constant_proportions' })).toThrow(ApiException);
    expect(() => resolvePositionFn({ name: 'constant_weights' })).toThrow(ApiException);
  });
  it('参数不合法 → 澄清信号（附参数说明）', () => {
    expect(() => resolveWeightFn({ name: 'constant_weights', params: { weights: 'abc' } })).toThrow(ClarificationSignal);
    try {
      resolveWeightFn({ name: 'ic_weight', params: { icWindow: 1 } });
      throw new Error('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ClarificationSignal);
      expect((e as ClarificationSignal).guide.参数说明).toContain('icWindow');
    }
  });
  it('ic_weight 解析返回窗口供引擎预计算', () => {
    expect(resolveWeightFn({ name: 'ic_weight', params: { icWindow: 10 } }).icWindow).toBe(10);
    expect(resolveWeightFn({ name: 'ic_weight' }).icWindow).toBe(20);
  });
});

describe('constant_weights / ic_weight 求值', () => {
  const factors = [
    { table: 't', field: 'a', direction: 1 as const },
    { table: 't', field: 'b', direction: 1 as const },
  ];
  it('constant_weights 给定比例按序对位（总和 >1 归一，排序权重按总和归一语义等价）', () => {
    const b = resolveWeightFn({ name: 'constant_weights', params: { weights: [3, 1] } });
    expect(b.fn({ factors, sections: [], pool: [], count: 2 })).toEqual([0.75, 0.25]);
  });
  it('ic_weight 正部归一化：负 IC 记 0', () => {
    const b = resolveWeightFn({ name: 'ic_weight', params: { icWindow: 10 } });
    expect(b.icWindow).toBe(10);
    const w = b.fn({
      factors,
      sections: [],
      icByFactor: { 't.a': 0.08, 't.b': -0.03 },
      pool: [],
      count: 2,
    });
    expect(w).toEqual([1, 0]);
  });
  it('IC 全负 → 回退等权', () => {
    const b = resolveWeightFn({ name: 'ic_weight' });
    const w = b.fn({ factors, sections: [], icByFactor: { 't.a': -1, 't.b': -2 }, pool: [], count: 2 });
    expect(w).toEqual([0.5, 0.5]);
  });
});

describe('constant_proportions / factor_position 求值', () => {
  const ctx = {
    candidates: [
      { code: 'A', rank: 1, score: 90 },
      { code: 'B', rank: 2, score: 70 },
    ],
    remainingCash: 100_000,
    remainingPct: 100,
    maxPositions: 2,
  };
  it('constant_proportions 按名次对位 × 剩余资金', () => {
    const b = resolvePositionFn({ name: 'constant_proportions', params: { proportions: [0.7] } });
    const amounts = b.fn(ctx);
    expect(amounts.A).toBeCloseTo(70_000);
    expect(amounts.B).toBeCloseTo(30_000);
  });
  it('factor_position 正部比例加权；全 ≤0 → 空仓字典', () => {
    const b = resolvePositionFn({ name: 'factor_position', params: { factor: { table: 't', field: 'BIAS20' } } });
    expect(b.factorRef).toEqual({ table: 't', field: 'BIAS20' });
    const amounts = b.fn({ ...ctx, sizingSection: new Map([['A', 2], ['B', -1]]) });
    expect(amounts.A).toBeCloseTo(100_000);
    expect(amounts.B).toBe(0); // 权重 0 → 金额 0（引擎跳过买入）
    expect(resolvePositionFn({ name: 'factor_position', params: { factor: { table: 't', field: 'X' } } }).fn({ ...ctx, sizingSection: new Map([['A', -5], ['B', -1]]) })).toEqual({});
  });
});

describe('validatePositionAmounts（整手/现金逐条修正）', () => {
  const priceOf = (code: string): number | undefined => ({ A: 10, B: 20 }[code]);
  it('整手向下取整', () => {
    const r = validatePositionAmounts({ A: 1234 }, { cash: 100_000, priceOf });
    expect(r.fixed.A).toBe(1_000); // 1234 元 @10 → 123.4 股 → 1 手 = 100 股 = 1000 元
    expect(r.violations).toHaveLength(0);
  });
  it('不足一手 → 剔除并告警', () => {
    const r = validatePositionAmounts({ A: 500 }, { cash: 100_000, priceOf });
    expect(r.fixed.A).toBeUndefined();
    expect(r.violations[0]).toContain('不足一手');
  });
  it('现金不足 → 缩减到剩余额度；无法成手则剔除', () => {
    const r = validatePositionAmounts({ A: 5_000, B: 5_000 }, { cash: 7_000, priceOf });
    expect(r.fixed.A).toBe(5_000);
    expect(r.fixed.B).toBe(2_000); // 7000-5000=2000 → 1 手 × 20 = 2000
    expect(r.violations[0]).toContain('现金不足');
    const r2 = validatePositionAmounts({ A: 5_000, B: 5_000 }, { cash: 5_500, priceOf });
    expect(r2.fixed.B).toBeUndefined();
    expect(r2.violations[0]).toContain('已剔除');
  });
  it('显式 0 仓位 = 不买，不计违规', () => {
    const r = validatePositionAmounts({ A: 0 }, { cash: 100_000, priceOf });
    expect(r.fixed).toEqual({});
    expect(r.violations).toHaveLength(0);
  });
});

describe('描述与展示', () => {
  it('名录分 kind 输出', () => {
    expect(describeFunctions('factor-weight')).toContain('constant_weights');
    expect(describeFunctions('factor-weight')).not.toContain('constant_proportions');
    expect(describeFunctions('position')).toContain('factor_position');
  });
  it('formatFnCall：名称+参数原文；未知函数回退 JSON', () => {
    expect(formatFnCall('position', { name: 'constant_proportions', params: { proportions: [0.6, 0.4] } })).toContain('常数比例');
    expect(formatFnCall('position', { name: 'nope' })).toContain('nope');
  });
});
