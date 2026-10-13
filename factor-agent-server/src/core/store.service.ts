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

  /* ----- 用户 ----- */
  abstract getProfile(): UserProfile;
  abstract updateSetting(key: string, patch: { on?: boolean | null; value?: string }): ProfileSetting | undefined;
}
