/* ==========================================================
   B-INT-02 策略业务（StrategiesServiceImpl）单元测试
   钉住四条业务规则：权重归一化、全 0 报 400、保存=自动重新回测（API-10）、
   回测确定性种子来源；UserStoreService / BacktestService 均为 mock
   运行：npx jest strategies.service.impl
   ========================================================== */
import { Test } from '@nestjs/testing';
import { ApiException } from '../../../src/common/api.exception';
import { BacktestService, BacktestOutput } from '../../../src/core/backtest.service';
import { UserStoreService } from '../../../src/core/user-store.service';
import { StrategiesService } from '../../../src/strategies/strategies.service';
import { StrategiesServiceImpl } from '../../../src/strategies/implementations/strategies.service.impl';
import { Strategy } from '../../../src/types';

/* 回测引擎的固定假输出（引擎自身行为由 D 模块自己测，这里只关心写回逻辑） */
const fakeBt = (): BacktestOutput => ({
  curve: [100, 101, 102.5],
  benchCurve: [100, 100.4, 100.9],
  metrics: { annual: 12.3, drawdown: 8.1, sharpe: 1.2, winRate: 55 },
  holdings: [{ code: '600519', name: '贵州茅台', score: 91.2, weight: 10, change: 1.2 }],
});

const seedStrategy = (patch: Partial<Strategy> = {}): Strategy => ({
  id: 'sx',
  name: '种子策略',
  status: 'draft',
  universe: '沪深300',
  rebalance: '每月调仓',
  benchmark: '沪深300指数',
  updatedAt: '2026-09-28',
  factors: [
    { name: '价值', weight: 50 },
    { name: '成长', weight: 50 },
  ],
  metrics: null,
  curve: Array(30).fill(100),
  benchCurve: Array(30).fill(100),
  holdings: [],
  ...patch,
});

/* 因子权重归一化断言：合计精确 100、每位保留 1 位小数 */
function expectNormalized(factors: { name: string; weight: number }[]) {
  const sum = factors.reduce((a, f) => a + f.weight, 0);
  expect(+sum.toFixed(1)).toBe(100);
  for (const f of factors) expect(+f.weight.toFixed(1)).toBe(f.weight);
}

describe('B-INT-02 StrategiesServiceImpl（策略业务）', () => {
  const USER = 1;
  const store = {
    listStrategies: jest.fn(),
    getStrategy: jest.fn(),
    saveStrategy: jest.fn(),
    deleteStrategy: jest.fn(),
  };
  const btEngine = { runBacktest: jest.fn() };
  let svc: StrategiesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    btEngine.runBacktest.mockImplementation(() => fakeBt());
    const moduleRef = await Test.createTestingModule({
      providers: [
        StrategiesServiceImpl,
        { provide: UserStoreService, useValue: store },
        { provide: BacktestService, useValue: btEngine },
      ],
    }).compile();
    svc = moduleRef.get(StrategiesServiceImpl);
  });

  /** 断言 fn 抛出统一契约异常：HTTP 状态码 + error.code */
  async function expectApiError(fn: () => unknown, status: number, code: string): Promise<void> {
    try {
      await fn();
      throw new Error(`期望抛出 ApiException(${code})，实际没有抛出`);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiException);
      expect((e as ApiException).getStatus()).toBe(status);
      expect((e as ApiException).code).toBe(code);
    }
  }

  /* ---------- list / remove ---------- */

  it('list：透传 store.listStrategies(userId)', async () => {
    const data = [seedStrategy()];
    store.listStrategies.mockResolvedValue(data);
    expect(await svc.list(USER)).toBe(data);
  });

  it('remove：删除成功无返回；策略不存在抛 404 NOT_FOUND', async () => {
    store.deleteStrategy.mockResolvedValue(true);
    expect(await svc.remove(USER, 'sx')).toBeUndefined();

    store.deleteStrategy.mockResolvedValue(false);
    await expectApiError(() => svc.remove(USER, 'nope'), 404, 'NOT_FOUND');
  });

  /* ---------- create：默认值 + 归一化 + 草稿形态 ---------- */

  it('create：默认 universe/rebalance/benchmark、草稿态、指标为空曲线平', async () => {
    const s = await svc.create(USER, { name: '新策略', factors: [{ name: '价值', weight: 60 }, { name: '成长', weight: 40 }] });

    expect(s.id).toMatch(/^s/);
    expect(s.name).toBe('新策略');
    expect(s.universe).toBe('沪深300 + 中证500');
    expect(s.rebalance).toBe('每月调仓');
    expect(s.benchmark).toBe('沪深300指数');
    expect(s.status).toBe('draft');
    expect(s.metrics).toBeNull();
    expect(s.curve).toEqual(Array(30).fill(100));
    expect(s.holdings).toEqual([]);
    expect(s.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.saveStrategy).toHaveBeenCalledTimes(1);
    /* 创建动作本身不回测 */
    expect(btEngine.runBacktest).not.toHaveBeenCalled();
  });

  it('create：权重合计 ≠100 按比例折算到精确 100（50/40/30 → 41.7/33.3/25.0）', async () => {
    const s = await svc.create(USER, {
      name: '新策略',
      factors: [{ name: '价值', weight: 50 }, { name: '成长', weight: 40 }, { name: '动量', weight: 30 }],
    });
    expectNormalized(s.factors);
    expect(s.factors.map((f) => f.weight)).toEqual([41.7, 33.3, 25]);
  });

  it('create：universe 含中证1000 时默认基准为中证1000指数', async () => {
    const s = await svc.create(USER, { name: '新策略', universe: '中证1000', factors: [{ name: '价值', weight: 100 }] });
    expect(s.benchmark).toBe('中证1000指数');
  });

  it('create：权重全 0 抛 400 INVALID_ARGUMENT，且不落库', async () => {
    await expectApiError(
      () => svc.create(USER, { name: '新策略', factors: [{ name: '价值', weight: 0 }, { name: '成长', weight: 0 }] }),
      400,
      'INVALID_ARGUMENT',
    );
    expect(store.saveStrategy).not.toHaveBeenCalled();
  });

  /* ---------- update：保存 = 归一化 + 自动重新回测（API-10） ---------- */

  it('update：策略不存在抛 404 NOT_FOUND', async () => {
    store.getStrategy.mockResolvedValue(undefined);
    await expectApiError(() => svc.update(USER, 'nope', { name: '改名' }), 404, 'NOT_FOUND');
  });

  it('update：只改传入字段，并自动重新回测 draft→done、报告写回、重新落库', async () => {
    const stored = seedStrategy();
    store.getStrategy.mockResolvedValue(stored);

    const s = await svc.update(USER, 'sx', {
      name: '改名后的策略',
      factors: [{ name: '价值', weight: 40 }, { name: '成长', weight: 40 }, { name: '动量', weight: 40 }],
    });

    expect(s.name).toBe('改名后的策略');
    expect(s.universe).toBe('沪深300');
    expectNormalized(s.factors);
    /* 40/40/40 → 33.4/33.3/33.3（残差补给最大项） */
    expect(s.factors.map((f) => f.weight)).toEqual([33.4, 33.3, 33.3]);
    /* 自动回测且结果写回 */
    expect(btEngine.runBacktest).toHaveBeenCalledTimes(1);
    expect(s.status).toBe('done');
    expect(s.metrics).toEqual(fakeBt().metrics);
    expect(s.curve).toEqual(fakeBt().curve);
    expect(s.holdings).toEqual(fakeBt().holdings);
    expect(store.saveStrategy).toHaveBeenCalledWith(USER, s);
  });

  it('update：权重全 0 抛 400，配置不被回测污染', async () => {
    const stored = seedStrategy();
    store.getStrategy.mockResolvedValue(stored);
    await expectApiError(
      () => svc.update(USER, 'sx', { factors: [{ name: '价值', weight: 0 }] }),
      400,
      'INVALID_ARGUMENT',
    );
    expect(btEngine.runBacktest).not.toHaveBeenCalled();
    expect(store.saveStrategy).not.toHaveBeenCalled();
  });

  /* ---------- backtest：种子来源 + topK 截断 + 状态保持 ---------- */

  it('backtest：seedKey 由 id|universe|rebalance|因子权重 构成，topK 上限截到 10', async () => {
    const stored = seedStrategy({ status: 'done' });
    store.getStrategy.mockResolvedValue(stored);

    await svc.backtest(USER, 'sx', { topK: 30 });

    const input = btEngine.runBacktest.mock.calls[0][0];
    expect(input.seedKey).toBe(`sx|沪深300|每月调仓|${JSON.stringify(stored.factors)}`);
    expect(input.holdingsCount).toBe(10);
    expect(input.universe).toBe('沪深300');
  });

  it('backtest：结果写回策略，非草稿状态保持不变，topK 正常透传', async () => {
    const stored = seedStrategy({ status: 'done' });
    store.getStrategy.mockResolvedValue(stored);

    const s = await svc.backtest(USER, 'sx', { topK: 5 });

    expect(btEngine.runBacktest.mock.calls[0][0].holdingsCount).toBe(5);
    expect(s.status).toBe('done');
    expect(s.metrics).toEqual(fakeBt().metrics);
    expect(s.curve).toEqual(fakeBt().curve);
    expect(s.benchCurve).toEqual(fakeBt().benchCurve);
    expect(store.saveStrategy).toHaveBeenCalledWith(USER, s);
  });

  it('backtest：策略不存在抛 404 NOT_FOUND', async () => {
    store.getStrategy.mockResolvedValue(undefined);
    await expectApiError(() => svc.backtest(USER, 'nope', {}), 404, 'NOT_FOUND');
  });

  /* ---------- getReport：报告视图 ---------- */

  it('getReport：返回 metrics/curve/benchCurve/holdings 四字段；策略不存在抛 404', async () => {
    const stored = seedStrategy({ status: 'done', metrics: fakeBt().metrics });
    store.getStrategy.mockResolvedValue(stored);

    const report = await svc.getReport(USER, 'sx');
    expect(Object.keys(report).sort()).toEqual(['benchCurve', 'curve', 'holdings', 'metrics']);
    expect(report.metrics).toEqual(fakeBt().metrics);

    store.getStrategy.mockResolvedValue(undefined);
    await expectApiError(() => svc.getReport(USER, 'nope'), 404, 'NOT_FOUND');
  });
});
