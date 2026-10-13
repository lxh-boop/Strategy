import { Injectable } from '@nestjs/common';
import {
  BtParamItem,
  Conversation,
  ChatMessage,
  FactorLibItem,
  FactorWeight,
  ProfileSetting,
  Strategy,
  UserProfile,
} from '../../types';
import {
  BT_PARAMS,
  CURVE_FLAT,
  CURVE_S1,
  CURVE_S2,
  CURVE_S3,
  FACTOR_LIB,
  LastReport,
  nowTime,
  StoreService,
  WELCOME_TEXT,
} from '../store.service';

/* ==========================================================
   存储实现：内存 + 种子测试样例（演示版）
   - 测试样例：4 个种子策略、用户资料、因子库
   - 数据不出进程，重启恢复种子；换持久化时新增实现并在 core.module 切换
   ========================================================== */

const fw = (name: string, weight: number): FactorWeight => ({ name, weight });

function seedStrategies(): Strategy[] {
  const mkBench = (curve: number[]) => curve.map((v, i) => +(100 + (v - 100) * 0.45 + Math.sin(i / 4) * 1.8).toFixed(1));
  return [
    {
      id: 's1',
      name: '稳健红利低波组合',
      status: 'running',
      universe: '沪深300 + 中证500',
      rebalance: '每月调仓',
      benchmark: '中证红利指数',
      updatedAt: '2026-09-21',
      factors: [fw('股息率', 35), fw('低波动', 30), fw('质量', 20), fw('价值', 15)],
      metrics: { annual: 14.6, drawdown: -8.3, sharpe: 1.62, winRate: 63.5 },
      curve: CURVE_S1,
      benchCurve: mkBench(CURVE_S1),
      holdings: [
        { code: '600036', name: '招商银行', score: 92.4, weight: 6.8, change: 1.24 },
        { code: '601088', name: '中国神华', score: 90.1, weight: 6.2, change: 0.86 },
        { code: '600941', name: '中国移动', score: 88.7, weight: 5.9, change: 0.42 },
        { code: '601288', name: '农业银行', score: 87.5, weight: 5.5, change: -0.31 },
        { code: '600028', name: '中国石化', score: 85.9, weight: 5.1, change: 0.65 },
      ],
    },
    {
      id: 's2',
      name: '成长质量双驱动',
      status: 'running',
      universe: '中证800',
      rebalance: '每两周调仓',
      benchmark: '中证800成长',
      updatedAt: '2026-09-22',
      factors: [fw('成长', 40), fw('质量', 35), fw('动量', 25)],
      metrics: { annual: 21.3, drawdown: -14.7, sharpe: 1.38, winRate: 58.2 },
      curve: CURVE_S2,
      benchCurve: mkBench(CURVE_S2),
      holdings: [
        { code: '300750', name: '宁德时代', score: 94.2, weight: 7.4, change: 2.13 },
        { code: '002594', name: '比亚迪', score: 91.8, weight: 6.9, change: 1.57 },
        { code: '600519', name: '贵州茅台', score: 89.5, weight: 6.1, change: -0.44 },
        { code: '000333', name: '美的集团', score: 88.2, weight: 5.8, change: 0.91 },
        { code: '300059', name: '东方财富', score: 86.6, weight: 5.3, change: 1.78 },
      ],
    },
    {
      id: 's3',
      name: '小盘动量增强',
      status: 'done',
      universe: '中证1000',
      rebalance: '每周调仓',
      benchmark: '中证1000指数',
      updatedAt: '2026-09-19',
      factors: [fw('动量', 45), fw('小市值', 25), fw('流动性', 20), fw('情绪', 10)],
      metrics: { annual: 26.8, drawdown: -19.4, sharpe: 1.21, winRate: 55.6 },
      curve: CURVE_S3,
      benchCurve: mkBench(CURVE_S3),
      holdings: [
        { code: '301269', name: '华大九天', score: 93.6, weight: 5.2, change: 3.42 },
        { code: '688256', name: '寒武纪', score: 92.1, weight: 5.0, change: 4.18 },
        { code: '300308', name: '中际旭创', score: 90.4, weight: 4.8, change: 2.65 },
        { code: '688041', name: '海光信息', score: 89.3, weight: 4.6, change: 1.93 },
        { code: '300502', name: '新易盛', score: 88.0, weight: 4.4, change: 2.87 },
      ],
    },
    {
      id: 's4',
      name: '基本面价值精选（草稿）',
      status: 'draft',
      universe: '全市场（剔除ST）',
      rebalance: '每季度调仓',
      benchmark: '沪深300指数',
      updatedAt: '2026-09-15',
      factors: [fw('价值', 50), fw('质量', 30), fw('股息率', 20)],
      metrics: null,
      curve: CURVE_FLAT,
      benchCurve: CURVE_FLAT,
      holdings: [],
    },
  ];
}

function seedProfile(): UserProfile {
  return {
    name: '陈研究员',
    org: 'XX证券 · 金融工程组',
    plan: '专业版会员',
    registerDate: '2025-11-02',
    lastLogin: '2026-09-23 09:12',
    radar: [
      { name: '价值', value: 78 },
      { name: '成长', value: 65 },
      { name: '动量', value: 82 },
      { name: '质量', value: 70 },
      { name: '低波动', value: 58 },
    ],
    settings: [
      { key: 'notify', icon: 'bell', title: '调仓与信号通知', desc: '策略触发买卖信号时推送提醒', type: 'toggle', on: true },
      { key: 'report', icon: 'file', title: '每日策略日报', desc: '每个交易日收盘后生成持仓分析', type: 'toggle', on: true },
      { key: 'risk', icon: 'shield', title: '风险偏好', desc: '影响智能体推荐策略的风格', type: 'single', on: null,
        choices: ['保守型', '稳健型', '平衡型', '积极型'], value: '稳健型' },
    ],
  };
}

@Injectable()
export class MemoryStoreService extends StoreService {
  private readonly strategies = new Map<string, Strategy>(seedStrategies().map((s) => [s.id, s]));
  private readonly conversations = new Map<string, Conversation>();
  private readonly lastReports = new Map<string, LastReport>();
  private profile: UserProfile = seedProfile();

  /* ----- 策略 ----- */
  listStrategies(): Strategy[] {
    return [...this.strategies.values()];
  }

  getStrategy(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  saveStrategy(strategy: Strategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  deleteStrategy(id: string): boolean {
    return this.strategies.delete(id);
  }

  /* ----- 会话 ----- */
  listConversations(): Conversation[] {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id);
  }

  newConversation(): Conversation {
    const conv: Conversation = {
      id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6),
      title: '新对话',
      updatedAt: Date.now(),
      messages: [{ role: 'agent', bubble: WELCOME_TEXT, time: nowTime() }],
    };
    this.conversations.set(conv.id, conv);
    return conv;
  }

  deleteConversation(id: string): boolean {
    this.lastReports.delete(id);
    return this.conversations.delete(id);
  }

  clearConversation(id: string): Conversation | undefined {
    const conv = this.conversations.get(id);
    if (!conv) return undefined;
    conv.title = '新对话';
    conv.updatedAt = Date.now();
    conv.messages = [{ role: 'agent', bubble: WELCOME_TEXT, time: nowTime() }];
    this.lastReports.delete(id);
    return conv;
  }

  appendMessages(id: string, msgs: ChatMessage[]): Conversation | undefined {
    const conv = this.conversations.get(id);
    if (!conv) return undefined;
    conv.messages.push(...msgs);
    conv.updatedAt = Date.now();
    return conv;
  }

  renameConversationFromFirstMessage(id: string, text: string): void {
    const conv = this.conversations.get(id);
    if (!conv || conv.title !== '新对话') return;
    conv.title = text.length > 16 ? text.slice(0, 16) + '…' : text;
  }

  /* ----- 会话级智能体配置 ----- */
  getLastReport(convId: string): LastReport | undefined {
    return this.lastReports.get(convId);
  }

  setLastReport(convId: string, report: LastReport): void {
    this.lastReports.set(convId, report);
  }

  /* ----- 因子库 / 参数 ----- */
  getFactorLib(): FactorLibItem[] {
    return FACTOR_LIB;
  }

  getBtParams(): BtParamItem[] {
    return BT_PARAMS;
  }

  /* ----- 用户 ----- */
  getProfile(): UserProfile {
    return this.profile;
  }

  updateSetting(key: string, patch: { on?: boolean | null; value?: string }): ProfileSetting | undefined {
    const setting = this.profile.settings.find((s) => s.key === key);
    if (!setting) return undefined;
    if (patch.on !== undefined) setting.on = patch.on;
    if (patch.value !== undefined) setting.value = patch.value;
    return setting;
  }
}
