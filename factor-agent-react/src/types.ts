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
  id?: string;           // 前端生成的卡片标识，用于"已保存"状态
  title: string;
  tag: string;
  note?: string;
}

/** 等权回测可复现配置：TOOL-C07 旧卡片（等权特例）随身携带（API-27 保存策略用），
 *  同时持久化在 Strategy.backtestConfig 上——重新回测按它重跑真引擎。
 *  与后端 src/types.ts 字段级一致（A/B 共同维护）；历史存量卡片/策略仍是此结构 */
export interface BacktestRunConfig {
  factors: { table: string; field: string; order: "desc" | "asc" }[];
  startDate: string;   // YYYYMMDD
  endDate: string;     // YYYYMMDD
  frequency: "daily" | "weekly" | "biweekly" | "monthly" | "quarterly" | "semiannual" | "annual" | "custom";
  everyNTd?: number;   // frequency=custom 时必填：每 N 个交易日
  topK: number;
  benchmark: "hs300" | "csi500" | "sse";
  feeRate?: number;    // 单边费率（0~0.05）；缺省/0 = 不计费用（旧配置兼容）
}

/* ----- 策略回测（日频事件内核，StrategySpec v1）卡片类型，与后端字段级一致 ----- */

export interface StrategyFilterRule {
  table: string;
  field: string;
  /** '>'/'<'/'eq'/'bw'；bw 为 [下限, 上限] 闭区间 */
  op: ">" | "<" | "eq" | "bw";
  value: number | [number, number];
  /** 大盘条件（table=mkt_idxd）的挂靠指数，缺省 sse；个股条件不可传 */
  indexCode?: "hs300" | "csi500" | "sse";
}

/** 不卖条件（结构与 entryFilters 元素同构；命中的持仓跳过全部卖出检查与调仓换出） */
export interface StrategyKeepRule {
  table: string;
  field: string;
  op: ">" | "<" | "eq" | "bw";
  value: number | [number, number];
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
  | { kind: "field"; table: string; field: string; op: ">" | "<"; value: number }
  | { kind: "stop_profit"; pct: number }
  | { kind: "stop_loss"; pct: number }
  | { kind: "max_drawdown_from_entry"; pct: number }
  | { kind: "max_hold_days"; days: number }
  | { kind: "rank_out"; bottomN: number };

/** 策略回测可复现配置（run_strategy_backtest 卡片随身携带，API-27 保存策略用） */
export interface StrategyRunConfig {
  strategyType?: string;
  securityIds?: string[] | null;   // null/缺省 = 全市场
  startDate: string;               // YYYYMMDD
  endDate: string;                 // YYYYMMDD
  initialCapital?: number;
  feeRate?: number;
  rebalanceIntervalDays: number;   // 每 N 个交易日调仓
  executionTiming?: 0 | 1;         // 0=开盘价 1=收盘价
  maxPositions?: number;
  idealPositionPct?: number;
  minPositionPct?: number;
  entryFilters?: StrategyFilterRule[];
  sortFactors?: StrategySortFactor[];
  sellRules?: StrategySellRule[];
  /** 不卖条件（可选；命中的持仓继续持有，优先级高于卖出规则与调仓换出） */
  keepRules?: StrategyKeepRule[];
  /** 排除时间段（可选，≤5 段；段内只结算不交易、冻结估值） */
  excludeRanges?: { start: number; end: number }[];
  /** 触发模式（rebalanceIntervalDays=0）的仓位偏离带宽 % */
  positionDeviatePct?: number;
  /** 大盘择时叠加（结构同后端 core/timing.ts） */
  timingOverlay?: {
    index: "hs300" | "csi500" | "sse";
    rules: { table: string; field: string; op: ">" | "<" | "bw"; value?: number; low?: number; high?: number }[];
    enterVotes: number;
    exitVotes: number;
    bearPositionPct: number;
  };
  benchmark?: "hs300" | "csi500" | "sse";
}

/** 回测交易明细（日频事件内核产出；卡片截最近若干笔） */
export interface BacktestTrade {
  /** 交易日 YYYYMMDD */
  date: number;
  /** 证券代码 000002.XSHE */
  code: string;
  direction: "buy" | "sell";
  price: number;
  shares: number;
  amount: number;
  fee: number;
  /** 触发原因：调仓建仓/调仓补仓/调仓减持/调仓卖出/排名跌出/止盈/止损/回撤止盈/持有满N个交易日/字段触发 */
  reason: string;
}

export interface BacktestCard extends CardBase {
  type: "backtest";
  curve: number[];
  benchCurve: number[];
  benchName?: string;
  metrics: MetricItem[];
  /** 本次回测实际使用的参数（真实口径，后端回测工具产出）：
   *  新引擎含排序因子方向/权重、过滤/卖出规则等；缺省（历史消息旧卡片）时前端回退显示策略配置项 */
  params?: BtParamItem[];
  /** 可复现配置（服务端按它重跑真引擎）：前端"保存为我的策略"（API-27）的数据来源；
   *  新引擎卡片为 StrategyRunConfig；历史等权卡片为 BacktestRunConfig；
   *  缺省（历史旧卡片）时无保存入口 */
  config?: StrategyRunConfig | BacktestRunConfig;
  /** 曲线逐点对应的交易日（YYYYMMDD，与 curve 等长）：x 轴按真实日期打刻度；
   *  缺省（历史旧卡片/mock 曲线）时回退月频推算 */
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

/** 每期持仓明细行（PeriodHoldingsRow：与后端 core/strategy-backtest.service.ts 同构） */
export interface PeriodHoldingsRow {
  seq: number;
  startDate: number;
  endDate: number;
  holdings: {
    code: string;
    shares: number;
    closePrice: number;
    entryPrice: number;
    periodReturnPct: number;
    weightPct: number;
  }[];
}

/** 排名分析卡（果仁「排名分析」对标：因子分段有效性评估，个股级 IC 口径） */
export interface RankAnalysisCard extends CardBase {
  type: "rank_analysis";
  /** 分析因子（table/field/direction） */
  factor: { table: string; field: string; direction: 1 | -1 };
  /** 分段数 2~10 */
  segmentCount: number;
  /** 分析间隔（交易日） */
  intervalDays: number;
  /** 有效分析期数（期对数） */
  periodCount: number;
  icMean?: number;
  icPositiveProb?: number;
  icIR?: number;
  monotonicityR2: number;
  longShortSpreadPct: number;
  /** IC 序列（曲线数据） */
  icSeries: { date: number; ic: number }[];
  /** 各段平均单期收益 %（段 1 = 最优先段） */
  segmentMeanReturnPct: number[];
  /** 各段区间累计收益 % */
  segmentCumulativePct: number[];
  /** 逐期段收益 %（段×期；某期段内无成员为 null）。旧存量卡无此字段 */
  segmentPeriodReturnsPct?: (number | null)[][];
  /** 多空虚拟净值（段1−末段逐期复合，起点 100）。旧存量卡无此字段 */
  longShortSeries?: { date: number; nav: number }[];
  /** IC 衰减（持有期 1~5 日平均 IC）。旧存量卡无此字段 */
  icDecay?: { lag: number; ic: number }[];
}

/** 每日选股清单卡（run_daily_screen 产出：单日截面 → 过滤 → 排序 → 入选清单） */
export interface ScreenCard extends CardBase {
  type: "screen";
  /** 实际查询交易日（YYYYMMDD；非交易日自动回落到前一交易日） */
  date: number;
  /** 入选清单（综合分降序）；factorValues 与 sortFactors 一一对应（缺值 null） */
  stocks: { code: string; score: number; factorValues: (number | null)[] }[];
  /** 有效排序因子（usedDefaultSort 时含默认动量） */
  sortFactors: { table: string; field: string; direction: 1 | -1 }[];
  usedDefaultSort: boolean;
  entryFilters: StrategyFilterRule[];
  /** 过滤前候选池 */
  rawPoolSize: number;
  /** 过滤后存活数 */
  survivedCount: number;
}

/** 因子相关性矩阵卡（对称矩阵 + 色阶） */
export interface CorrelationCard extends CardBase {
  type: "correlation";
  /** 因子标识顺序（"table.field"），与矩阵行列一致 */
  factors: string[];
  /** 对称相关矩阵：对角线 1；样本不足的配对 null */
  matrix: (number | null)[][];
  periodCount: number;
}

export type AgentCard = BacktestCard | RankAnalysisCard | CorrelationCard | ScreenCard;

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
   stage 为工具中文名（可直接展示），最终回复以 final 事件为准；
   keepalive 为链路保活帧（无内容语义），api 层照常喂空闲看门狗、hook 不消费 */
export type ChatProgressEvent =
  | { type: "start" }
  | { type: "keepalive" }
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
  metrics: RawMetrics | null;
  curve: number[];
  benchCurve: number[];
  holdings: Holding[];
  /** 由回测卡片生成（API-27）时记录的等权回测配置：
   *  存在 = 重新回测（API-11）走等权真引擎，且权重/股票池/调仓/基准不可改（等权合成，权重不可调） */
  /** 由回测卡片生成（API-27）时记录的回测配置：
   *  存在 = 重新回测（API-11）走真引擎，且权重/股票池/调仓/基准不可改。
   *  旧等权卡片为 BacktestRunConfig；新引擎卡片为 StrategyRunConfig */
  backtestConfig?: BacktestRunConfig | StrategyRunConfig;
  /** 曲线逐点交易日（YYYYMMDD，与 curve 等长）：仅等权真引擎产出，详情图按真实日期打刻度 */
  dates?: number[];
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
