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
  /** 本次回测实际使用的参数（真实口径，后端 TOOL-C07 产出）：
   *  回测区间 / 调仓频率·期数 / 每期持仓 / 业绩基准 / 交易费用；
   *  缺省（历史消息旧卡片）时前端回退显示策略配置项 */
  params?: BtParamItem[];
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

/* ----- 发消息流式过程事件（SSE 节点级推送，契约 §3.1 chat/stream） -----
   粒度 = 工具调用的开始与结果，不做 token 级推理流式；
   stage 为工具中文名（可直接展示），最终回复以 final 事件为准 */
export type ChatProgressEvent =
  | { type: "start" }
  | { type: "tool_call"; name: string; stage: string; args: string }
  | { type: "tool_result"; name: string; stage: string; ok: boolean; detail: string };

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
export type SettingType = "toggle" | "single";

export interface ProfileSetting {
  key: string;
  icon: SettingIcon;
  title: string;
  desc: string;
  type: SettingType;
  on?: boolean | null;    // toggle 型：开关状态；其余类型为 null
  choices?: string[];     // single 型可选项
  value?: string;         // single 型的当前值（展示口径，后端下发）
}

export interface UserProfile {
  name: string;
  org: string;
  plan: string;
  registerDate: string;
  lastLogin: string;
  radar: { name: string; value: number }[];
  settings: ProfileSetting[];
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
