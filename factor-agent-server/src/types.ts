/* ==========================================================
   共享类型 — 与前端 factor-agent-react/src/types.ts 保持一致
   ========================================================== */

import type { PeriodHoldingsRow, StrategyPeriodRow } from './core/strategy-backtest.service';
import type { StrategyTimingOverlay } from './core/timing';

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
  /** 年化换手（单边，%）：策略回测真引擎填入；mock 引擎与历史存量数据无此字段 */
  turnover?: number;
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

/** 等权回测可复现配置：TOOL-C07 旧卡片（等权特例）随身携带（API-27 保存策略用），
 *  同时持久化在 Strategy.backtestConfig 上——重新回测按它重跑真引擎。
 *  历史存量卡片/策略仍是此结构，服务端 legacyConfigToInput 适配到新引擎 */
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

/* ----- 策略回测（日频事件内核，StrategySpec v1）卡片类型 ----- */

export interface StrategyFilterRule {
  table: string;
  field: string;
  op: '>' | '<';
  value: number;
}

export interface StrategySortFactor {
  table: string;
  field: string;
  /** 1=值大优 / -1=值小优 */
  direction: 1 | -1;
  /** 缺省 = 等权 1/N；加权模式必须全部因子都传 */
  weight?: number;
}

export type StrategySellRule =
  | { kind: 'field'; table: string; field: string; op: '>' | '<'; value: number }
  | { kind: 'stop_profit'; pct: number }
  | { kind: 'stop_loss'; pct: number }
  | { kind: 'max_drawdown_from_entry'; pct: number }
  | { kind: 'max_hold_days'; days: number }
  | { kind: 'rank_out'; bottomN: number };

/** 策略回测可复现配置（run_strategy_backtest 卡片随身携带，API-27 保存策略用）：
 *  结构即引擎入参 StrategySpec v1 的归一化形态 */
export interface StrategyRunConfig {
  strategyType?: string;
  securityIds?: string[] | null;   // null/缺省 = 全市场
  startDate: string;               // YYYYMMDD
  endDate: string;                 // YYYYMMDD
  initialCapital?: number;
  feeRate?: number;
  rebalanceIntervalDays: number;   // 每 N 个交易日调仓（0 = 触发模式）
  /** 仓位带宽 %：触发模式必传（5~50，总仓位偏离目标 ±带宽即再平衡）；调仓模式可选（择时拉回阈值，默认 1） */
  positionDeviatePct?: number;
  executionTiming?: 0 | 1;         // 0=开盘价 1=收盘价
  maxPositions?: number;
  idealPositionPct?: number;
  minPositionPct?: number;
  entryFilters?: StrategyFilterRule[];
  sortFactors?: StrategySortFactor[];
  sellRules?: StrategySellRule[];
  benchmark?: 'hs300' | 'csi500' | 'sse';
  /** 大盘择时叠加（结构同 core/timing.ts StrategyTimingOverlay） */
  timingOverlay?: StrategyTimingOverlay;
}

/** 回测交易明细（日频事件内核产出；卡片截最近若干笔） */
export interface BacktestTrade {
  /** 交易日 YYYYMMDD */
  date: number;
  /** 证券代码 000002.XSHE */
  code: string;
  direction: 'buy' | 'sell';
  price: number;
  shares: number;
  amount: number;
  fee: number;
  /** 触发原因：调仓建仓/调仓补仓/调仓减持/调仓卖出/排名跌出/止盈/止损/回撤止盈/持有满N个交易日/字段触发 */
  reason: string;
}

export interface BacktestCard extends CardBase {
  type: 'backtest';
  curve: number[];
  benchCurve: number[];
  benchName?: string;
  metrics: MetricItem[];
  /** 本次回测实际使用的参数（真实口径，区别于 GET /backtest-params 下发的策略配置项）：
   *  前端回测卡片按行渲染（新引擎含排序因子方向/权重、过滤/卖出规则等） */
  params?: { label: string; value: string; hint?: string }[];
  /** 可复现配置：前端"保存为我的策略"（API-27）的数据来源。
   *  新引擎卡片为 StrategyRunConfig；历史等权卡片为 BacktestRunConfig */
  config?: StrategyRunConfig | BacktestRunConfig;
  /** 曲线逐点对应的交易日（YYYYMMDD，与 curve 等长）：前端按真实日期画 x 轴刻度 */
  dates?: number[];
  /** 交易明细（最近 50 笔，时间正序）；旧等权卡片无此字段 */
  trades?: BacktestTrade[];
  /** 月度归因（自然月收益 %）；旧等权卡片无此字段 */
  monthly?: { month: string; pct: number }[];
  /** 仓位分布（择时启用时的各仓位档天数）；未择时缺省 */
  positionDist?: { label: string; days: number }[];
  /** 持股时间占比 %（暴露>0 的交易日占比，对齐果仁 open-rate）；未择时缺省 */
  holdingDaysPct?: number;
  /** 踏空归因：基准单日涨幅 Top10 中暴露不足的交易日；未择时缺省 */
  missedRallies?: { date: number; pct: number; exposure: number }[];
  /** 历史持仓详情（按调仓期聚合，对标果仁同名面板） */
  periods?: { seq: number; startDate: number; endDate: number; positionPct: number; stockCount: number; buyCount: number; sellCount: number; turnoverPct: number; periodReturnPct: number; benchReturnPct: number; excessPct: number; cumulativeValue: number }[];
  /** 每期持仓明细（重放交易流水聚合，对标果仁「每日选股」历史版）：每期期末持有什么、各股期间收益与权重 */
  periodHoldings?: PeriodHoldingsRow[];
  /** 最新调仓指令：最后一期的全部成交（时间正序） */
  latestOrders?: BacktestTrade[];
  /** 最近卖出的证券代码（最后一期，按卖出先后去重） */
  recentSold?: string[];
}

export type AgentCard = BacktestCard; // report/stocks 卡（演示时代）2026-10-13 已下线，库中零存量

export interface AgentReply {
  text: string;
  card?: AgentCard; // 普通对话（chat）与 LLM 失败的回复没有卡片
}

/* ----- 智能体过程事件（SSE 节点级推送；不涉及推理流式） -----
   粒度 = 图节点/工具的开始与结果，一条一个结构化事件；
   stage 为工具中文名（前端可直接展示），detail 为一行结果摘要。
   keepalive 为链路保活帧（无内容语义）：GLM 思考/工具执行的长静默段定期发送，
   前端空闲看门狗据此不把"活着但慢"误判成死链路。
   最终文案与卡片不走过程事件，以接口返回值 / final 事件为准。 */
export type AgentProgressEvent =
  | { type: 'start' }
  | { type: 'keepalive' }
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
  /** 由回测卡片生成（API-27）时记录的回测配置：
   *  存在 = 重新回测（API-11）走真引擎，且权重/股票池/调仓/基准不可改（等权合成，权重不可调）。
   *  旧等权卡片为 BacktestRunConfig（legacyConfigToInput 适配新引擎）；新卡片为 StrategyRunConfig */
  backtestConfig?: BacktestRunConfig | StrategyRunConfig;
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
export interface BtParamItem {
  label: string;
  value: string;
  hint: string;
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
