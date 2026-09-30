import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { UserStoreService } from '../../core/user-store.service';
import { ProfileSetting, UserProfile } from '../../types';
import { UserService } from '../user.service';

/* ==========================================================
   用户业务实现：个人资料组装 + 设置项更新（白名单校验在 DTO，业务层兜底 404）
   M13：profile 各字段来源见 backend-api.md §7.5 ——
   name=nickname、org/plan 平台固定文案、registerDate/lastLogin 取 users 表、
   radar 按该用户策略因子聚合（无策略为空数组）、settings 三项存中文显示值。
   ========================================================== */

/** 设置项展示元数据（与前端 ProfilePage 渲染口径一致；value/on 存库） */
const SETTINGS_META: Record<'notify' | 'report' | 'risk', Omit<ProfileSetting, 'key' | 'on' | 'value'>> = {
  notify: { icon: 'bell', title: '调仓与信号通知', desc: '策略触发买卖信号时推送提醒', type: 'toggle' },
  report: { icon: 'file', title: '每日策略日报', desc: '每个交易日收盘后生成持仓分析', type: 'toggle' },
  risk: {
    icon: 'shield',
    title: '风险偏好',
    desc: '影响智能体推荐策略的风格',
    type: 'single',
    choices: ['保守型', '稳健型', '平衡型', '积极型'],
  },
};

@Injectable()
export class UserServiceImpl extends UserService {
  constructor(private readonly users: UserStoreService) {
    super();
  }

  async getProfile(userId: number): Promise<UserProfile> {
    const user = await this.users.findUserById(userId);
    if (!user) throw new ApiException('AUTH_REQUIRED', 401, '用户不存在或已被删除');

    const settings = await this.users.getSettings(userId);
    const strategies = await this.users.listStrategies(userId);

    return {
      name: user.nickname,
      org: 'AlphaSage 团队',
      plan: '团队版',
      registerDate: String(user.createdAt).slice(0, 10),
      lastLogin: user.lastLoginAt ? String(user.lastLoginAt).slice(0, 16) : '',
      radar: this.aggregateRadar(strategies),
      settings: [
        { key: 'notify', ...SETTINGS_META.notify, on: settings.notify },
        { key: 'report', ...SETTINGS_META.report, on: settings.report },
        { key: 'risk', ...SETTINGS_META.risk, value: settings.risk },
      ],
    };
  }

  async updateSetting(userId: number, key: string, payload: { on?: boolean; value?: string }): Promise<UserProfile> {
    if (!['notify', 'report', 'risk'].includes(key)) {
      throw new ApiException('NOT_FOUND', 404, `未知的设置项: ${key}`);
    }
    await this.users.updateSetting(userId, key as 'notify' | 'report' | 'risk', payload);
    return this.getProfile(userId);
  }

  /** 因子偏好雷达：按用户全部策略的因子权重聚合（同名因子取平均），无策略为 [] */
  private aggregateRadar(strategies: { factors: { name: string; weight: number }[] }[]): { name: string; value: number }[] {
    const sum = new Map<string, { total: number; count: number }>();
    for (const s of strategies) {
      for (const f of s.factors) {
        const acc = sum.get(f.name) ?? { total: 0, count: 0 };
        acc.total += f.weight;
        acc.count += 1;
        sum.set(f.name, acc);
      }
    }
    return [...sum.entries()]
      .map(([name, { total, count }]) => ({ name, value: Math.round(total / count) }))
      .sort((a, b) => b.value - a.value);
  }
}
