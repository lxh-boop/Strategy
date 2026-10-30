/* ==========================================================
   B-INT-02 策略业务（StrategiesServiceImpl）单元测试
   钉住收口后的规则：草稿创建已下线（400 引导去对话）、
   旧版草稿只读（更新/重跑 400）、回测卡片策略按可复现配置重跑真引擎并写回；
   UserStoreService / StrategyBacktestService 均为 mock
   运行：npx jest strategies.service.impl
   ========================================================== */
import { Test } from '@nestjs/testing';
import { ApiException } from '../../../src/common/api.exception';
import { StrategyBacktestService, StrategyBacktestOutput } from '../../../src/core/strategy-backtest.service';
import { UserStoreService } from '../../../src/core/user-store.service';
import { StrategiesService } from '../../../src/strategies/strategies.service';
import { StrategiesServiceImpl } from '../../../src/strategies/implementations/strategies.service.impl';
import { Strategy, StrategyRunConfig } from '../../../src/types';

/* 真引擎的固定假输出（引擎自身行为由 D 模块自己测，这里只关心写回逻辑） */
const fakeOut = (): StrategyBacktestOutput => ({
  card: {
    type: 'backtest',
    title: '测试回测',
    tag: '回测报告',
    curve: [100, 101, 102.5],
    benchCurve: [100, 100.4, 100.9],
    dates: [20240102, 20240103, 20240104],
    metrics: [],
  },
  summary: {},
  metrics: { annual: 12.3, drawdown: -8.1, sharpe: 1.2, winRate: 55 },
});

/* 回测卡片保存时随身携带的可复现配置（新引擎 StrategyRunConfig 形态） */
const cardConfig: StrategyRunConfig = {
  startDate: '20240101',
  endDate: '20241231',
  rebalanceIntervalDays: 20,
  maxPositions: 10,
  sortFactors: [{ table: 'fmomentum', field: 'revs_20', direction: 1 }],
};

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

describe('B-INT-02 StrategiesServiceImpl（策略业务，收口对话真引擎）', () => {
  const USER = 1;
  const store = {
    listStrategies: jest.fn(),
    getStrategy: jest.fn(),
    saveStrategy: jest.fn(),
    incrementFactorUsage: jest.fn().mockResolvedValue(undefined),
    deleteStrategy: jest.fn(),
  };
  const strategyBt = { runStrategyBacktest: jest.fn(), checkRange: jest.fn(), preflight: jest.fn() };
  let svc: StrategiesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    strategyBt.runStrategyBacktest.mockImplementation(async () => fakeOut());
    const moduleRef = await Test.createTestingModule({
      providers: [
        StrategiesServiceImpl,
        { provide: UserStoreService, useValue: store },
        { provide: StrategyBacktestService, useValue: strategyBt },
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

  /* ---------- create：草稿创建已下线 ---------- */

  it('create：一律 400 引导去对话创建，不落库', async () => {
    await expectApiError(
      () => svc.create(USER, { name: '新策略', factors: [{ name: '价值', weight: 100 }] }),
      400,
      'INVALID_ARGUMENT',
    );
    expect(store.saveStrategy).not.toHaveBeenCalled();
  });

  /* ---------- update：旧草稿只读；卡片策略只许改名（改名=重跑） ---------- */

  it('update：策略不存在抛 404 NOT_FOUND', async () => {
    store.getStrategy.mockResolvedValue(undefined);
    await expectApiError(() => svc.update(USER, 'nope', { name: '改名' }), 404, 'NOT_FOUND');
  });

  it('update：旧版草稿（无 backtestConfig）任何更新都 400，引擎不启动、不落库', async () => {
    store.getStrategy.mockResolvedValue(seedStrategy());
    await expectApiError(() => svc.update(USER, 'sx', { name: '改名' }), 400, 'INVALID_ARGUMENT');
    await expectApiError(
      () => svc.update(USER, 'sx', { factors: [{ name: '价值', weight: 100 }] }),
      400,
      'INVALID_ARGUMENT',
    );
    expect(strategyBt.runStrategyBacktest).not.toHaveBeenCalled();
    expect(store.saveStrategy).not.toHaveBeenCalled();
  });

  it('update：卡片策略改因子等配置项 400（等权不可调，请回对话重测）', async () => {
    store.getStrategy.mockResolvedValue(seedStrategy({ status: 'done', backtestConfig: cardConfig }));
    await expectApiError(
      () => svc.update(USER, 'sx', { factors: [{ name: '价值', weight: 100 }] }),
      400,
      'INVALID_ARGUMENT',
    );
    expect(strategyBt.runStrategyBacktest).not.toHaveBeenCalled();
  });

  it('update：卡片策略仅改名——按原配置重跑真引擎并写回', async () => {
    const stored = seedStrategy({ status: 'done', backtestConfig: cardConfig });
    store.getStrategy.mockResolvedValue(stored);

    const s = await svc.update(USER, 'sx', { name: '改名后的策略' });

    expect(s.name).toBe('改名后的策略');
    expect(strategyBt.runStrategyBacktest).toHaveBeenCalledTimes(1);
    expect(strategyBt.runStrategyBacktest.mock.calls[0][0]).toBe(cardConfig);
    expect(s.metrics).toEqual(fakeOut().metrics);
    expect(s.curve).toEqual(fakeOut().card.curve);
    expect(s.dates).toEqual(fakeOut().card.dates);
    expect(s.status).toBe('done');
    expect(store.saveStrategy).toHaveBeenCalledWith(USER, s);
  });

  /* ---------- backtest：旧草稿 400；卡片策略重跑真引擎 ---------- */

  it('backtest：旧版草稿不支持重跑，抛 400 引导去对话重建', async () => {
    store.getStrategy.mockResolvedValue(seedStrategy());
    await expectApiError(() => svc.backtest(USER, 'sx', {}), 400, 'INVALID_ARGUMENT');
    expect(strategyBt.runStrategyBacktest).not.toHaveBeenCalled();
    expect(store.saveStrategy).not.toHaveBeenCalled();
  });

  it('backtest：卡片策略按存储的可复现配置重跑真引擎，结果写回并落库', async () => {
    const stored = seedStrategy({ status: 'done', backtestConfig: cardConfig });
    store.getStrategy.mockResolvedValue(stored);

    const s = await svc.backtest(USER, 'sx', { topK: 5 });

    expect(strategyBt.runStrategyBacktest).toHaveBeenCalledTimes(1);
    expect(strategyBt.runStrategyBacktest.mock.calls[0][0]).toBe(cardConfig);
    expect(s.status).toBe('done');
    expect(s.metrics).toEqual(fakeOut().metrics);
    expect(s.curve).toEqual(fakeOut().card.curve);
    expect(s.benchCurve).toEqual(fakeOut().card.benchCurve);
    expect(s.dates).toEqual(fakeOut().card.dates);
    expect(store.saveStrategy).toHaveBeenCalledWith(USER, s);
  });

  it('backtest：策略不存在抛 404 NOT_FOUND', async () => {
    store.getStrategy.mockResolvedValue(undefined);
    await expectApiError(() => svc.backtest(USER, 'nope', {}), 404, 'NOT_FOUND');
  });

  /* ---------- createFromBacktest：API-27 卡片保存（策略唯一出生地） ---------- */

  it('createFromBacktest：按卡片 config 重跑真引擎，保存带可复现配置的 done 策略', async () => {
    const s = await svc.createFromBacktest(USER, {
      name: '卡片策略',
      config: cardConfig as unknown as Record<string, unknown>,
    });

    expect(strategyBt.runStrategyBacktest).toHaveBeenCalledTimes(1);
    expect(strategyBt.runStrategyBacktest.mock.calls[0][0]).toBe(cardConfig);
    expect(s.id).toMatch(/^s/);
    expect(s.name).toBe('卡片策略');
    expect(s.status).toBe('done');
    expect(s.universe).toBe('全市场（因子表覆盖）');
    expect(s.rebalance).toBe('每20个交易日调仓');
    expect(s.benchmark).toBe('沪深300');
    expect(s.backtestConfig).toBe(cardConfig);
    /* 因子展示权重：单因子等权折算为 100% */
    expect(s.factors).toEqual([{ name: 'revs_20(大值优)', weight: 100 }]);
    expect(s.metrics).toEqual(fakeOut().metrics);
    expect(s.dates).toEqual(fakeOut().card.dates);
    expect(store.saveStrategy).toHaveBeenCalledWith(USER, s);
  });

  /* ---------- getReport：报告视图 ---------- */

  it('getReport：返回 metrics/curve/benchCurve/holdings 四字段；策略不存在抛 404', async () => {
    const stored = seedStrategy({ status: 'done', metrics: fakeOut().metrics });
    store.getStrategy.mockResolvedValue(stored);

    const report = await svc.getReport(USER, 'sx');
    expect(Object.keys(report).sort()).toEqual(['benchCurve', 'curve', 'holdings', 'metrics']);
    expect(report.metrics).toEqual(fakeOut().metrics);

    store.getStrategy.mockResolvedValue(undefined);
    await expectApiError(() => svc.getReport(USER, 'nope'), 404, 'NOT_FOUND');
  });
});
