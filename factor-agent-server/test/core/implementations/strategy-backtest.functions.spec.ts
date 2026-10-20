import { ApiException } from '../../../src/common/api.exception';
import { ClarificationSignal } from '../../../src/core/strategy-backtest.service';
import { FactorDataService, QuoteRow } from '../../../src/core/factor-data.service';
import { StrategyBacktestServiceImpl } from '../../../src/core/implementations/strategy-backtest.service.impl';
import { CODE_A, CODE_B, defaultQuotes, makeStrategyService } from '../test-utils';

/* ==========================================================
   权重/仓位函数 全流程 stub 测试：内化等价性对拍 + ic_weight/factor_position 挂载
   ========================================================== */

const baseArgs = {
  securityIds: [CODE_A, CODE_B],
  startDate: '20240101',
  endDate: '20240108',
  initialCapital: 100_000,
  feeRate: 0,
  rebalanceIntervalDays: 2,
  maxPositions: 2,
};

/** 两因子截面：REVS20 值大优选 B，RSI 值小优选 A——权重 [3,1] 偏向 REVS20 */
const twoFactorPanels = {
  'equ_factor_obos.REVS20': {
    20240102: { [CODE_A]: 10, [CODE_B]: 90 },
    20240104: { [CODE_A]: 20, [CODE_B]: 80 },
  },
  'equ_factor_obos.RSI': {
    20240102: { [CODE_A]: 30, [CODE_B]: 10 },
    20240104: { [CODE_A]: 40, [CODE_B]: 20 },
  },
};

describe('权重/仓位函数（全流程 stub，不触库）', () => {
  it('constant_weights 归一不变性：[3,1] 与 [0.75,0.25] 同配置（交易与净值逐位一致）', async () => {
    const sortFactors = [
      { table: 'equ_factor_obos', field: 'REVS20', direction: 1 as const },
      { table: 'equ_factor_obos', field: 'RSI', direction: -1 as const },
    ];
    const run = (weights: [number, number]) =>
      makeStrategyService({ momentum: {}, panels: twoFactorPanels, quotes: defaultQuotes() }).runStrategyBacktest({
        ...baseArgs,
        sortFactors,
        weightFn: { name: 'constant_weights', params: { weights } },
      });
    const scaled = await run([3, 1]);
    const normalized = await run([0.75, 0.25]);
    expect(scaled.card.trades).toEqual(normalized.card.trades);
    expect(scaled.card.curve).toEqual(normalized.card.curve);
    expect(normalized.summary.权重函数).toContain('常数比例');
    expect(normalized.summary.权重函数).toContain('[0.75,0.25]');
  });

  it('未知函数名 → 400 附名录；参数不合法 → 澄清信号', async () => {
    await expect(
      makeStrategyService({ momentum: {}, quotes: defaultQuotes() }).runStrategyBacktest({ ...baseArgs, weightFn: { name: 'nope' } }),
    ).rejects.toThrow(/可用名录/);
    await expect(
      makeStrategyService({ momentum: {}, quotes: defaultQuotes() }).runStrategyBacktest({
        ...baseArgs,
        weightFn: { name: 'ic_weight', params: { icWindow: 1 } },
      }),
    ).rejects.toThrow(ClarificationSignal);
  });

  it('factor_position：定权因子 ≤0 的候选不买（金额 0），>0 独占资金', async () => {
    const out = await makeStrategyService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 },
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },
      },
      panels: {
        // BIAS20：A 站上均线（>0），B 在下方（≤0）→ B 金额 0 不买
        'equ_factor_obos.BIAS20': {
          20240102: { [CODE_A]: 0.2, [CODE_B]: -0.1 },
          20240104: { [CODE_A]: 0.3, [CODE_B]: -0.2 },
        },
      },
      quotes: defaultQuotes(),
    }).runStrategyBacktest({
      ...baseArgs,
      positionFn: { name: 'factor_position', params: { factor: { table: 'equ_factor_obos', field: 'BIAS20' } } },
    });
    // 0103 建仓只有 A（B 金额 0 跳过）：A 独占目标市值（10 万 × 50% 理想仓位 = 5 万 → T+1 开盘 10.5 → 4700 股）
    expect((out.card.trades ?? []).filter((t) => t.code === CODE_B)).toEqual([]);
    expect((out.card.trades ?? [])[0]).toMatchObject({
      date: 20240103,
      code: CODE_A,
      direction: 'buy',
      price: 10.5,
      shares: 4700,
      amount: 49_350,
      reason: '调仓建仓',
    });
    expect((out.card.params ?? []).some((r) => r.label === '仓位函数')).toBe(true);
  });

  it('ic_weight：全流程可跑（IC 上下文按窗口预取，不触未来）', async () => {
    const out = await makeStrategyService({
      momentum: {
        20240102: { [CODE_A]: 10, [CODE_B]: 20 },
        20240103: { [CODE_A]: 12, [CODE_B]: 19 },
        20240104: { [CODE_A]: 30, [CODE_B]: 5 },
      },
      quotes: defaultQuotes(),
    }).runStrategyBacktest({
      ...baseArgs,
      weightFn: { name: 'ic_weight' },
    });
    expect(out.card.curve.length).toBeGreaterThan(0);
    expect(out.summary.权重函数).toContain('IC');
  });

  it('触发模式 + 函数 → 400（二期再议）', async () => {
    await expect(
      makeStrategyService({ momentum: {}, quotes: defaultQuotes() }).runStrategyBacktest({
        ...baseArgs,
        rebalanceIntervalDays: 0,
        positionDeviatePct: 10,
        weightFn: { name: 'constant_weights' },
      }),
    ).rejects.toThrow(/触发模式/);
  });
});
