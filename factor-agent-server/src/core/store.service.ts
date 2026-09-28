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
   存储接口（契约层）—— 只定义"数据存取能做什么"，不关心怎么存。
   实现：implementations/memory-store.service.ts（内存 + 种子测试样例）
   ========================================================== */

/** 新会话的欢迎语（与前端演示文案一致） */
export const WELCOME_TEXT =
  '你好，陈研究员 👋 我是你的多因子选股智能体。\n\n我可以帮你：\n· 构建多因子选股策略（价值 / 成长 / 动量 / 质量 / 低波动等）\n· 对策略进行历史回测与绩效归因\n· 按条件筛选股票并输出综合因子得分\n\n试试下方的快捷指令，或直接描述你的需求。';

/** 预设曲线（演示口径，内存实现与前端 mock.ts 共用，保证演示数据一致） */
export const CURVE_S1 = [100, 100.8, 101.5, 100.9, 102.3, 103.6, 103.1, 104.8, 106.2, 105.6, 107.4, 109.1, 108.5, 110.3, 112.0, 111.4, 113.2, 114.9, 116.1, 115.4, 117.2, 119.0, 120.6, 119.8, 121.5, 123.2, 122.6, 124.4, 126.1, 127.5];
export const CURVE_S2 = [100, 101.2, 100.4, 102.6, 103.8, 102.9, 105.1, 107.3, 106.2, 108.8, 111.0, 109.7, 112.4, 115.1, 113.8, 116.6, 119.3, 118.0, 121.2, 124.0, 122.6, 125.8, 128.9, 127.4, 130.8, 133.6, 132.1, 135.4, 138.2, 140.6];
export const CURVE_S3 = [100, 99.2, 101.5, 103.1, 101.2, 104.4, 106.8, 104.2, 107.9, 110.5, 108.1, 112.3, 115.6, 112.9, 117.4, 120.8, 117.6, 122.5, 126.3, 123.1, 128.4, 132.2, 129.0, 134.6, 138.9, 135.2, 141.0, 145.3, 141.8, 147.2];
export const CURVE_FLAT = Array(30).fill(100);

/** 因子库（API-14 下发内容，与 docs/factors.md 的 9 个因子一致） */
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

/** 回测参数展示项（API-15 下发内容） */
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

/** 演示股票池：附带筛选用的指标属性（测试样例数据，非真实行情） */
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

/** 对话中最近一次构建报告的参数（供后续"回测一下"等追问复用；智能体的会话级记忆） */
export interface LastReport {
  name: string;
  tag: string;
  factors: FactorWeight[];
  universe: string;
  rebalance: string;
  benchName: string;
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

/**
 * 存储接口：策略 / 会话 / 会话级智能体配置 / 配置型数据 / 用户。
 * B 是这些数据的唯一写入口；C 只允许使用 getLastReport / setLastReport。
 */
@Injectable()
export abstract class StoreService {
  /* ----- 策略 ----- */
  abstract listStrategies(): Strategy[];
  abstract getStrategy(id: string): Strategy | undefined;
  abstract saveStrategy(strategy: Strategy): void;
  abstract deleteStrategy(id: string): boolean;

  /* ----- 会话 ----- */
  abstract listConversations(): Conversation[];
  abstract getConversation(id: string): Conversation | undefined;
  abstract newConversation(): Conversation;
  abstract deleteConversation(id: string): boolean;
  abstract clearConversation(id: string): Conversation | undefined;
  abstract appendMessages(id: string, msgs: ChatMessage[]): Conversation | undefined;
  abstract renameConversationFromFirstMessage(id: string, text: string): void;

  /* ----- 会话级智能体配置（"当前策略"记忆） ----- */
  abstract getLastReport(convId: string): LastReport | undefined;
  abstract setLastReport(convId: string, report: LastReport): void;

  /* ----- 配置型数据 ----- */
  abstract getFactorLib(): FactorLibItem[];
  abstract getBtParams(): BtParamItem[];
  abstract getStockPool(): StockMeta[];

  /* ----- 用户 ----- */
  abstract getProfile(): UserProfile;
  abstract updateSetting(key: string, patch: { on?: boolean | null; value?: string }): ProfileSetting | undefined;
}
