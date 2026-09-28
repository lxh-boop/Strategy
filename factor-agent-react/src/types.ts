/* ==========================================================
   全局类型定义 — 前后端共用类型可从这里抽出去
   ========================================================== */

export type Role = "user" | "agent";

export interface MetricItem {
  label: string;
  value: string;
  cls?: string;          // "up" | "down" | ""
}

export interface FactorWeight {
  name: string;
  weight: number;
}

export interface RawMetrics {
  annual: number;
  drawdown: number;
  sharpe: number;
  winRate: number;
}

export interface Holding {
  code: string;
  name: string;
  score: number;
  weight: number;
  change: number;
}

/* ----- 智能体回复卡片 ----- */
interface CardBase {
  id?: string;           // 前端生成的卡片标识，用于"已保存"状态
  title: string;
  tag: string;
  note?: string;
}

export interface BacktestCard extends CardBase {
  type: "backtest";
  curve: number[];
  benchCurve: number[];
  benchName?: string;
  metrics: MetricItem[];
}

export interface ReportCard extends CardBase {
  type: "report";
  factors: FactorWeight[];
  curve: number[];
  benchCurve: number[];
  benchName?: string;
  metrics: MetricItem[];
  rawMetrics?: RawMetrics;
  universe?: string;
  rebalance?: string;
}

export interface StocksCard extends CardBase {
  type: "stocks";
  stocks: { code: string; name: string; score: number; weight: number | null }[];
}

export type AgentCard = BacktestCard | ReportCard | StocksCard;

export interface AgentReply {
  text: string;
  card?: AgentCard;       // 普通对话（chat）与 LLM 失败的回复没有卡片
}

/* ----- 对话 ----- */
export interface ChatMessage {
  role: Role;
  bubble: string;
  time: string;
  card?: AgentCard;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

/* ----- 策略 ----- */
export type StrategyStatus = "running" | "done" | "draft";

export interface Strategy {
  id: string;
  name: string;
  status: StrategyStatus;
  universe: string;
  rebalance: string;
  benchmark: string;
  updatedAt: string;
  factors: FactorWeight[];
  metrics: RawMetrics | null;   // 草稿策略未回测时为 null
  curve: number[];
  benchCurve: number[];
  holdings: Holding[];
}

/* ----- 个人中心 ----- */
export type SettingIcon = "bell" | "file" | "key" | "database" | "shield";
export type SettingType = "toggle" | "keys" | "multi" | "single";

export interface ProfileSetting {
  key: string;
  icon: SettingIcon;
  title: string;
  desc: string;
  type: SettingType;
  on?: boolean | null;    // toggle 型：开关状态；其余类型为 null
  choices?: string[];     // multi / single 型的可选项
  value?: string;         // keys / multi / single 型的当前值（展示口径，后端下发）
}

export interface ApiKeyEntry {
  name: string;           // 密钥名称，如 "聚宽行情数据"
  key: string;            // 服务端只下发脱敏值（如 jq_5****4f01），完整密钥不回传
}

export interface UserProfile {
  name: string;
  org: string;
  plan: string;
  registerDate: string;
  lastLogin: string;
  radar: { name: string; value: number }[];
  settings: ProfileSetting[];
  apiKeys: ApiKeyEntry[];
}

/* ----- 因子库 / 回测参数（后端下发，契约 §3.5） ----- */
export interface FactorLibItem {
  id: string;
  name: string;
  desc: string;
}

export interface BtParamItem {
  label: string;
  value: string;
  hint: string;
}
