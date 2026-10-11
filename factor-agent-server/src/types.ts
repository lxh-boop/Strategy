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

/** 等权回测可复现配置：TOOL-C07 卡片随身携带（API-27 保存策略用），
 *  同时持久化在 Strategy.backtestConfig 上——重新回测按它重跑真引擎 */
export interface BacktestRunConfig {
  factors: { table: string; field: string; order: 'desc' | 'asc' }[];
  startDate: string;   // YYYYMMDD
  endDate: string;     // YYYYMMDD
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual' | 'custom';
  everyNTd?: number;   // frequency=custom 时必填：每 N 个交易日
  topK: number;
  benchmark: 'hs300' | 'csi500' | 'sse';
  feeRate?: number;    // 单边费率（0~0.05）；缺省/0 = 不计费用（旧配置兼容）
}

export interface BacktestCard extends CardBase {
  type: 'backtest';
  curve: number[];
  benchCurve: number[];
  benchName?: string;
  metrics: MetricItem[];
  /** 本次回测实际使用的参数（真实口径，区别于 GET /backtest-params 下发的策略配置项）：
   *  回测区间 / 调仓频率·期数 / 每期持仓 / 业绩基准 / 交易费用，前端回测卡片按行渲染 */
  params?: { label: string; value: string; hint?: string }[];
  /** 可复现配置（服务端按它重跑等权引擎）：前端"保存为我的策略"（API-27）的数据来源 */
  config?: BacktestRunConfig;
  /** 曲线逐点对应的交易日（YYYYMMDD，与 curve 等长）：前端按真实日期画 x 轴刻度 */
  dates?: number[];
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

/* ----- 智能体过程事件（SSE 节点级推送；不涉及推理流式） -----
   粒度 = 图节点/工具的开始与结果，一条一个结构化事件；
   stage 为工具中文名（前端可直接展示），detail 为一行结果摘要。
   最终文案与卡片不走过程事件，以接口返回值 / final 事件为准。 */
export type AgentProgressEvent =
  | { type: 'start' }
  | { type: 'tool_call'; name: string; stage: string; args: string }
  | { type: 'tool_result'; name: string; stage: string; ok: boolean; detail: string }
  | { type: 'error'; message: string };

/** 过程事件接收端（conversations 层写 SSE 用） */
export type AgentProgressSink = (event: AgentProgressEvent) => void;

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
  /** 由回测卡片生成（API-27）时记录的等权回测配置：
   *  存在 = 重新回测（API-11）走等权真引擎，且权重/股票池/调仓/基准不可改（等权合成，权重不可调） */
  backtestConfig?: BacktestRunConfig;
  /** 曲线逐点交易日（YYYYMMDD，与 curve 等长）：仅等权真引擎产出，详情图按真实日期打刻度 */
  dates?: number[];
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
