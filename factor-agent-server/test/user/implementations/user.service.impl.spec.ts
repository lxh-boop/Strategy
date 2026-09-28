import { Test } from '@nestjs/testing';
import { ApiException } from '../../../src/common/api.exception';
import { StoreService } from '../../../src/core/store.service';
import { UserServiceImpl } from '../../../src/user/implementations/user.service.impl';
import { ProfileSetting, UserProfile } from '../../../src/types';

/* ==========================================================
   B-INT-04 用户接口实现单元测试
   UserServiceImpl：资料读取直通存储层；设置项更新未知 key 兜底 404
   ========================================================== */

/** 组装个人中心资料（settings 由用例按需注入） */
const makeProfile = (settings: ProfileSetting[]): UserProfile => ({
  name: '陈研究员',
  org: 'XX 证券研究所',
  plan: '专业版',
  registerDate: '2025-06-01',
  lastLogin: '2026-09-28 09:30',
  radar: [{ name: '收益能力', value: 80 }],
  settings,
});

describe('UserServiceImpl', () => {
  let service: UserServiceImpl;
  let store: { getProfile: jest.Mock; updateSetting: jest.Mock };

  beforeEach(async () => {
    store = { getProfile: jest.fn(), updateSetting: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserServiceImpl,
        { provide: StoreService, useValue: store },
      ],
    }).compile();

    service = moduleRef.get(UserServiceImpl);
  });

  describe('getProfile（个人中心资料）', () => {
    it('返回存储层的完整用户资料', () => {
      const profile = makeProfile([
        { key: 'notify', icon: 'bell', title: '调仓提醒', desc: '', type: 'toggle', on: true },
      ]);
      store.getProfile.mockReturnValue(profile);

      expect(service.getProfile()).toBe(profile);
      expect(store.getProfile).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateSetting（设置项更新）', () => {
    it('toggle 型：补丁交给存储层，返回更新后的完整资料', () => {
      const before = makeProfile([
        { key: 'notify', icon: 'bell', title: '调仓提醒', desc: '', type: 'toggle', on: true },
      ]);
      const after = makeProfile([
        { key: 'notify', icon: 'bell', title: '调仓提醒', desc: '', type: 'toggle', on: false },
      ]);
      store.updateSetting.mockReturnValue(after.settings[0]);
      store.getProfile.mockReturnValue(after);

      const result = service.updateSetting('notify', { on: false });

      expect(result).toBe(after);
      expect(result.settings[0].on).toBe(false);
      expect(result).not.toBe(before);
      expect(store.updateSetting).toHaveBeenCalledTimes(1);
      expect(store.updateSetting).toHaveBeenCalledWith('notify', { on: false });
    });

    it('single 型：value 补丁原样交给存储层', () => {
      store.updateSetting.mockReturnValue({
        key: 'risk', icon: 'shield', title: '风险偏好', desc: '', type: 'single',
        choices: ['稳健型', '进取型'], value: '进取型',
      });
      const profile = makeProfile([
        { key: 'risk', icon: 'shield', title: '风险偏好', desc: '', type: 'single', choices: ['稳健型', '进取型'], value: '进取型' },
      ]);
      store.getProfile.mockReturnValue(profile);

      const result = service.updateSetting('risk', { value: '进取型' });

      expect(result).toBe(profile);
      expect(store.updateSetting).toHaveBeenCalledWith('risk', { value: '进取型' });
    });

    it('未知 key：存储层返回空时抛 404 NOT_FOUND，message 携带 key', () => {
      store.updateSetting.mockReturnValue(undefined);

      let caught: unknown;
      try {
        service.updateSetting('nonexistent', { on: true });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(ApiException);
      const err = caught as ApiException;
      expect(err.getStatus()).toBe(404);
      expect(err.getResponse()).toEqual({
        code: 'NOT_FOUND',
        message: '未知的设置项: nonexistent',
      });
      // 失败时不应回读资料
      expect(store.getProfile).not.toHaveBeenCalled();
    });
  });
});
