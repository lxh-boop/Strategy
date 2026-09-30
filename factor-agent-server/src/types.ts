/* ==========================================================
   共享类型 — 与前端 factor-agent-react/src/types.ts 保持一致
   ========================================================== */

export type Role = 'user' | 'agent';

export interface MetricItem {
  label: string;
  value: string;
  cls?: string; // "up" | "down" | ""
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
  id?: string;
  title: string;
  tag: string;
  note?: string;
}

export interface BacktestCard extends CardBase {
  type: 'backtest';
  curve: number[];
  benchCurve: number[];
  benchName?: string;
  metrics: MetricItem[];
}

export interface ReportCard extends CardBase {
  type: 'report';
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
  type: 'stocks';
  stocks: { code: string; name: string; score: number; weight: number | null }[];
}

export type AgentCard = BacktestCard | ReportCard | StocksCard;

export interface AgentReply {
  text: string;
  card?: AgentCard; // 普通对话（chat）与 LLM 失败的回复没有卡片
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
export type StrategyStatus = 'running' | 'done' | 'draft';

export interface Strategy {
  id: string;
  name: string;
  status: StrategyStatus;
  universe: string;
  rebalance: string;
  benchmark: string;
  updatedAt: string;
  factors: FactorWeight[];
  metrics: RawMetrics | null;
  curve: number[];
  benchCurve: number[];
  holdings: Holding[];
}

/* ----- 个人中心 ----- */
export type SettingIcon = 'bell' | 'file' | 'key' | 'database' | 'shield';
export type SettingType = 'toggle' | 'single';

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

/* ----- 因子库 / 回测参数 / 选股筛选 ----- */
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

export interface ScreenFilter {
  field: string;
  op: string;
  value: number;
}

export interface ScreenResultStock {
  code: string;
  name: string;
  score: number;
  weight: number | null;
}

export interface ScreenResult {
  stocks: ScreenResultStock[];
  total: number;
}

/* ----- 登录鉴权（M13，与 backend-api.md §7.1 一致） ----- */

/** 用户公开信息（任何接口都不返回密码哈希） */
export interface UserPublic {
  id: number;
  username: string;
  nickname: string;
  /** ISO 8601 */
  createdAt: string;
}

/** 注册/登录成功响应 */
export interface AuthSuccess {
  /** JWT，前端存 localStorage，之后每个请求带 Authorization: Bearer <token> */
  token: string;
  user: UserPublic;
}
