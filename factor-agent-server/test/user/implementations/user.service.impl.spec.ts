import { Test } from '@nestjs/testing';
import { ApiException } from '../../../src/common/api.exception';
import { UserRow, UserStoreService } from '../../../src/core/user-store.service';
import { UserServiceImpl } from '../../../src/user/implementations/user.service.impl';
import { Strategy } from '../../../src/types';

/* ==========================================================
   B-INT-04 用户接口实现单元测试
   profile 组装口径（backend-api.md §7.5）：name=nickname、org/plan 固定文案、
   registerDate/lastLogin 取 users 表、radar 按策略因子聚合、settings 三项
   ========================================================== */

const makeUser = (patch: Partial<UserRow> = {}): UserRow => ({
  id: 1,
  username: 'zhangsan',
  passwordHash: '$2a$10$abcdefghijklmnopqrstuv',
  nickname: '小张',
  tokenVersion: 0,
  lastLoginAt: '2026-09-29 09:30:00',
  createdAt: '2025-06-01 12:00:00',
  ...patch,
});

const strategyWithFactors = (factors: { name: string; weight: number }[]): Strategy =>
  ({
    id: 's1',
    name: 'x',
    status: 'done',
    universe: '',
    rebalance: '',
    benchmark: '',
    updatedAt: '2026-09-29',
    factors,
    metrics: null,
    curve: [],
    benchCurve: [],
    holdings: [],
  }) as Strategy;

describe('UserServiceImpl（M13 后）', () => {
  const USER = 1;
  let service: UserServiceImpl;
  let store: {
    findUserById: jest.Mock;
    getSettings: jest.Mock;
    listStrategies: jest.Mock;
    updateSetting: jest.Mock;
  };

  beforeEach(async () => {
    store = {
      findUserById: jest.fn(),
      getSettings: jest.fn(),
      listStrategies: jest.fn(),
      updateSetting: jest.fn(),
    };
    store.findUserById.mockResolvedValue(makeUser());
    store.getSettings.mockResolvedValue({ notify: true, report: true, risk: '稳健型' });
    store.listStrategies.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [UserServiceImpl, { provide: UserStoreService, useValue: store }],
    }).compile();

    service = moduleRef.get(UserServiceImpl);
  });

  describe('getProfile（个人中心资料组装）', () => {
    it('字段口径按 §7.5：name=nickname、org/plan 固定文案、时间取 users 表', async () => {
      const profile = await service.getProfile(USER);

      expect(profile.name).toBe('小张');
      expect(profile.org).toBe('AlphaSage 团队');
      expect(profile.plan).toBe('团队版');
      expect(profile.registerDate).toBe('2025-06-01');
      expect(profile.lastLogin).toBe('2026-09-29 09:30');
      expect(store.findUserById).toHaveBeenCalledWith(USER);
    });

    it('未登录过时 lastLogin 为空字符串', async () => {
      store.findUserById.mockResolvedValue(makeUser({ lastLoginAt: null }));

      const profile = await service.getProfile(USER);
      expect(profile.lastLogin).toBe('');
    });

    it('settings 三项：notify/report 为 toggle（on），risk 为 single（中文 value）', async () => {
      store.getSettings.mockResolvedValue({ notify: false, report: true, risk: '积极型' });

      const profile = await service.getProfile(USER);

      expect(profile.settings.map((s) => s.key)).toEqual(['notify', 'report', 'risk']);
      expect(profile.settings[0]).toMatchObject({ key: 'notify', type: 'toggle', on: false });
      expect(profile.settings[2]).toMatchObject({
        key: 'risk',
        type: 'single',
        value: '积极型',
        choices: ['保守型', '稳健型', '平衡型', '积极型'],
      });
    });

    it('radar：按全部策略因子聚合取平均并降序；无策略为空数组', async () => {
      store.listStrategies.mockResolvedValue([
        strategyWithFactors([
          { name: '价值', weight: 80 },
          { name: '动量', weight: 40 },
        ]),
        strategyWithFactors([
          { name: '价值', weight: 60 },
          { name: '成长', weight: 30 },
        ]),
      ]);

      const profile = await service.getProfile(USER);

      expect(profile.radar).toEqual([
        { name: '价值', value: 70 },
        { name: '动量', value: 40 },
        { name: '成长', value: 30 },
      ]);

      store.listStrategies.mockResolvedValue([]);
      expect((await service.getProfile(USER)).radar).toEqual([]);
    });

    it('用户不存在抛 401 AUTH_REQUIRED（token 有效但用户已被删）', async () => {
      store.findUserById.mockResolvedValue(undefined);
      let caught: unknown;
      try {
        await service.getProfile(USER);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(ApiException);
      expect((caught as ApiException).getStatus()).toBe(401);
      expect((caught as ApiException).code).toBe('AUTH_REQUIRED');
    });
  });

  describe('updateSetting（设置项更新）', () => {
    it('toggle 型：补丁交给存储层，返回更新后的完整资料', async () => {
      store.updateSetting.mockResolvedValue(undefined);
      store.getSettings.mockResolvedValue({ notify: false, report: true, risk: '稳健型' });

      const profile = await service.updateSetting(USER, 'notify', { on: false });

      expect(store.updateSetting).toHaveBeenCalledWith(USER, 'notify', { on: false });
      expect(profile.settings[0].on).toBe(false);
    });

    it('single 型：value 原样交给存储层（中文显示值口径）', async () => {
      store.updateSetting.mockResolvedValue(undefined);
      store.getSettings.mockResolvedValue({ notify: true, report: true, risk: '保守型' });

      const profile = await service.updateSetting(USER, 'risk', { value: '保守型' });

      expect(store.updateSetting).toHaveBeenCalledWith(USER, 'risk', { value: '保守型' });
      expect(profile.settings[2].value).toBe('保守型');
    });

    it('未知 key：抛 404 NOT_FOUND，且不触存储层', async () => {
      let caught: unknown;
      try {
        await service.updateSetting(USER, 'nonexistent', { on: true });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ApiException);
      const err = caught as ApiException;
      expect(err.getStatus()).toBe(404);
      expect(err.getResponse()).toEqual({ code: 'NOT_FOUND', message: '未知的设置项: nonexistent' });
      expect(store.updateSetting).not.toHaveBeenCalled();
    });
  });
});
