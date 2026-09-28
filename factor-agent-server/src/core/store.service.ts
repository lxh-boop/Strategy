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
} from '../types';

/* ==========================================================
   内存存储（演示版） — 后续可平滑替换为数据库
   种子数据与前端 src/data/mock.ts 对齐
   ========================================================== */

/** 新会话的欢迎语（与前端 agent.ts 的 WELCOME_TEXT 一致） */
export const WELCOME_TEXT =
  '你好，陈研究员 👋 我是你的多因子选股智能体。\n\n我可以帮你：\n· 构建多因子选股策略（价值 / 成长 / 动量 / 质量 / 低波动等）\n· 对策略进行历史回测与绩效归因\n· 按条件筛选股票并输出综合因子得分\n\n试试下方的快捷指令，或直接描述你的需求。';

/** 预设曲线（与前端 mock.ts 相同，保证演示数据一致） */
export const CURVE_S1 = [100, 100.8, 101.5, 100.9, 102.3, 103.6, 103.1, 104.8, 106.2, 105.6, 107.4, 109.1, 108.5, 110.3, 112.0, 111.4, 113.2, 114.9, 116.1, 115.4, 117.2, 119.0, 120.6, 119.8, 121.5, 123.2, 122.6, 124.4, 126.1, 127.5];
export const CURVE_S2 = [100, 101.2, 100.4, 102.6, 103.8, 102.9, 105.1, 107.3, 106.2, 108.8, 111.0, 109.7, 112.4, 115.1, 113.8, 116.6, 119.3, 118.0, 121.2, 124.0, 122.6, 125.8, 128.9, 127.4, 130.8, 133.6, 132.1, 135.4, 138.2, 140.6];
export const CURVE_S3 = [100, 99.2, 101.5, 103.1, 101.2, 104.4, 106.8, 104.2, 107.9, 110.5, 108.1, 112.3, 115.6, 112.9, 117.4, 120.8, 117.6, 122.5, 126.3, 123.1, 128.4, 132.2, 129.0, 134.6, 138.9, 135.2, 141.0, 145.3, 141.8, 147.2];
export const CURVE_FLAT = Array(30).fill(100);

export const FACTOR_LIB: FactorLibItem[] = [
  { id: 'value', name: '价值因子', desc: 'EP、BP、股息率' },
  { id: 'growth', name: '成长因子', desc: '营收增速、净利润增速' },
  { id: 'momentum', name: '动量因子', desc: '20日/60日相对强弱' },
  { id: 'quality', name: '质量因子', desc: 'ROE、毛利率、现金流' },
  { id: 'lowvol', name: '低波动因子', desc: '波动率、特异波动' },
  { id: 'dividend', name: '股息率因子', desc: '近12个月股息率' },
  { id: 'liquidity', name: '流动性因子', desc: '换手率、成交额' },
  { id: 'size', name: '市值因子', desc: '总市值、流通市值' },
  { id: 'sentiment', name: '情绪因子', desc: '北向资金、分析师评级' },
];

export const BT_PARAMS: BtParamItem[] = [
  { label: '回测区间', value: '2023-09 ~ 2026-09', hint: '历史模拟回测区间，共 3 年' },
  { label: 'Top K', value: '50 只', hint: '每次调仓选取综合因子得分最高的 K 只股票' },
  { label: '手续费率', value: '双边 0.1%', hint: '买卖均按成交额收取，含佣金与印花税' },
];

/** 回测参数默认值（契约 §3.3） */
export const BT_DEFAULTS = {
  period: { start: '2023-09', end: '2026-09' },
  topK: 50,
  feeRate: 0.001,
};

/** 演示股票池：附带筛选用的指标属性（演示数据，非真实行情） */
export interface StockMeta {
  code: string;
  name: string;
  universes: string[];
  roeTtm: number;
  pePct: number;
  divYield: number;
  vol: number;
  mom20: number;
  baseScore: number;
}

const HS300 = ['沪深300', '中证800', '全市场'];
const CSI500 = ['中证500', '中证800', '全市场'];

export const STOCK_POOL: StockMeta[] = [
  { code: '600519', name: '贵州茅台', universes: HS300, roeTtm: 30.2, pePct: 22.5, divYield: 1.2, vol: 24, mom20: 3.1, baseScore: 91.2 },
  { code: '000858', name: '五粮液', universes: HS300, roeTtm: 24.1, pePct: 18.3, divYield: 1.8, vol: 27, mom20: 2.4, baseScore: 88.4 },
  { code: '601166', name: '兴业银行', universes: HS300, roeTtm: 17.5, pePct: 12.6, divYield: 5.6, vol: 21, mom20: 0.9, baseScore: 86.9 },
  { code: '601318', name: '中国平安', universes: HS300, roeTtm: 16.2, pePct: 25.4, divYield: 3.9, vol: 23, mom20: 1.5, baseScore: 85.7 },
  { code: '600276', name: '恒瑞医药', universes: HS300, roeTtm: 18.4, pePct: 28.2, divYield: 0.6, vol: 28, mom20: 4.3, baseScore: 84.3 },
  { code: '600036', name: '招商银行', universes: HS300, roeTtm: 15.8, pePct: 31.0, divYield: 5.1, vol: 20, mom20: 1.2, baseScore: 89.6 },
  { code: '601088', name: '中国神华', universes: HS300, roeTtm: 15.5, pePct: 19.8, divYield: 6.4, vol: 19, mom20: 0.8, baseScore: 86.1 },
  { code: '600900', name: '长江电力', universes: HS300, roeTtm: 15.1, pePct: 29.4, divYield: 3.2, vol: 14, mom20: 1.1, baseScore: 85.9 },
  { code: '600941', name: '中国移动', universes: HS300, roeTtm: 12.9, pePct: 33.2, divYield: 4.4, vol: 16, mom20: 2.2, baseScore: 85.2 },
  { code: '000333', name: '美的集团', universes: HS300, roeTtm: 22.1, pePct: 34.0, divYield: 3.8, vol: 26, mom20: 2.9, baseScore: 87.4 },
  { code: '002594', name: '比亚迪', universes: HS300, roeTtm: 20.6, pePct: 47.0, divYield: 0.5, vol: 44, mom20: 5.4, baseScore: 88.2 },
  { code: '601899', name: '紫金矿业', universes: HS300, roeTtm: 21.3, pePct: 58.0, divYield: 1.4, vol: 35, mom20: 8.1, baseScore: 88.5 },
  { code: '300750', name: '宁德时代', universes: HS300, roeTtm: 22.4, pePct: 55.0, divYield: 0.3, vol: 42, mom20: 6.8, baseScore: 88.9 },
  { code: '688041', name: '海光信息', universes: CSI500, roeTtm: 26.4, pePct: 78.0, divYield: 0.2, vol: 55, mom20: 9.6, baseScore: 90.3 },
  { code: '300308', name: '中际旭创', universes: CSI500, roeTtm: 24.8, pePct: 66.0, divYield: 0.4, vol: 58, mom20: 11.2, baseScore: 89.8 },
  { code: '300059', name: '东方财富', universes: CSI500, roeTtm: 14.2, pePct: 62.0, divYield: 0.3, vol: 48, mom20: 7.3, baseScore: 86.4 },
];

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
      { key: 'model', icon: 'key', title: '模型配置', desc: '大模型由平台统一提供，不支持自行配置', type: 'readonly', on: null, value: '智谱 GLM' },
      { key: 'datasource', icon: 'database', title: '数据来源', desc: '行情与回测统一使用平台内部数据', type: 'readonly', on: null, value: '内部数据' },
      { key: 'risk', icon: 'shield', title: '风险偏好', desc: '影响智能体推荐策略的风格', type: 'single', on: null,
        choices: ['保守型', '稳健型', '平衡型', '积极型'], value: '稳健型' },
    ],
  };
}

/** 对话中最近一次构建报告的参数（供后续"回测一下"等追问复用） */
export interface LastReport {
  name: string;
  tag: string;
  factors: FactorWeight[];
  universe: string;
  rebalance: string;
  benchName: string;
}

@Injectable()
export class StoreService {
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

  /* ----- 会话级上下文 ----- */
  getLastReport(convId: string): LastReport | undefined {
    return this.lastReports.get(convId);
  }

  setLastReport(convId: string, report: LastReport): void {
    this.lastReports.set(convId, report);
  }

  /* ----- 因子库 / 参数 / 筛选池 ----- */
  getFactorLib(): FactorLibItem[] {
    return FACTOR_LIB;
  }

  getBtParams(): BtParamItem[] {
    return BT_PARAMS;
  }

  getStockPool(): StockMeta[] {
    return STOCK_POOL;
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

/** 当前时刻 "HH:mm"（消息 time 字段口径） */
export function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 今天 "YYYY-MM-DD"（策略 updatedAt 口径，与前端 todayStr 一致） */
export function todayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
