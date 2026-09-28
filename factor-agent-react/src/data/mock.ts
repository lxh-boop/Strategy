/* ==========================================================
   兜底数据层 — 前后端已打通，本文件仅保留两类内容：
   1. 纯 UI 文案（对话快捷指令）；
   2. 后端不可达时的兜底展示数据（与后端种子数据同口径）。
   正常链路下，因子库/回测参数/策略/个人中心均以后端接口为准。
   ========================================================== */
import type { BtParamItem, FactorLibItem, UserProfile } from "../types";

// 因子库兜底（正常由 GET /api/factors 下发）
export const FACTOR_LIB: FactorLibItem[] = [
  { id: "value", name: "价值因子", desc: "EP、BP、股息率" },
  { id: "growth", name: "成长因子", desc: "营收增速、净利润增速" },
  { id: "momentum", name: "动量因子", desc: "20日/60日相对强弱" },
  { id: "quality", name: "质量因子", desc: "ROE、毛利率、现金流" },
  { id: "lowvol", name: "低波动因子", desc: "波动率、特异波动" },
  { id: "dividend", name: "股息率因子", desc: "近12个月股息率" },
  { id: "liquidity", name: "流动性因子", desc: "换手率、成交额" },
  { id: "size", name: "市值因子", desc: "总市值、流通市值" },
  { id: "sentiment", name: "情绪因子", desc: "北向资金、分析师评级" },
];

// 回测参数兜底（正常由 GET /api/backtest-params 下发）；hint 为悬停说明
export const BT_PARAMS: BtParamItem[] = [
  { label: "回测区间", value: "2023-09 ~ 2026-09", hint: "历史模拟回测区间，共 3 年" },
  { label: "Top K", value: "50 只", hint: "每次调仓选取综合因子得分最高的 K 只股票" },
  { label: "手续费率", value: "双边 0.1%", hint: "买卖均按成交额收取，含佣金与印花税" },
];

// 个人中心兜底（正常由 GET /api/user/profile 下发）
export const PROFILE: UserProfile = {
  name: "陈研究员",
  org: "XX证券 · 金融工程组",
  plan: "专业版会员",
  registerDate: "2025-11-02",
  lastLogin: "2026-09-23 09:12",
  radar: [
    { name: "价值", value: 78 },
    { name: "成长", value: 65 },
    { name: "动量", value: 82 },
    { name: "质量", value: 70 },
    { name: "低波动", value: 58 },
  ],
  settings: [
    { key: "notify", icon: "bell", title: "调仓与信号通知", desc: "策略触发买卖信号时推送提醒", type: "toggle", on: true },
    { key: "report", icon: "file", title: "每日策略日报", desc: "每个交易日收盘后生成持仓分析", type: "toggle", on: true },
    { key: "model", icon: "key", title: "模型配置", desc: "大模型由平台统一提供，不支持自行配置", type: "readonly", on: null, value: "智谱 GLM" },
    { key: "datasource", icon: "database", title: "数据来源", desc: "行情与回测统一使用平台内部数据", type: "readonly", on: null, value: "内部数据" },
    { key: "risk", icon: "shield", title: "风险偏好", desc: "影响智能体推荐策略的风格", type: "single", on: null,
      choices: ["保守型", "稳健型", "平衡型", "积极型"], value: "稳健型" },
  ],
};

// 对话快捷指令（纯 UI 文案，不依赖后端）
export const CHAT_SUGGESTIONS = [
  "构建一个「低波动 + 高股息」防御型策略",
  "回测动量因子近三年的表现",
  "在沪深300里筛选 ROE > 15% 且估值分位低于 30% 的股票",
  "帮我分析一下当前白酒板块的因子暴露",
];
