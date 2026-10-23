/* ==========================================================
   测评任务定义类型（evals 套件的公共词汇）

   一个任务 = 一段脚本化的多轮用户输入 + 一组对"轨迹"的验收检查。
   轨迹由 harness 采集：模型每轮提出的原始工具调用（raw）、
   mock 引擎实收的调用（engine）、每轮回复、确认门挂起状态、token 用量。
   ========================================================== */

/** 任务类别：口径 / 防编造 / 澄清 / 确认路由 / 在线端到端 */
export type TaskCategory = 'calibration' | 'fabrication' | 'clarification' | 'confirm-routing' | 'e2e';

/** 确认门答复词（与后端 resumeConfirm 精确匹配协议同源）：'确认'/'确认执行' → approve，'授权调优' → delegate，其余 → feedback */
export type ConfirmAnswer = string;

/** 一个执行步骤。runner 按确认门状态校验步骤类型：
 *  - 无挂起确认 → 只允许 user 步骤（模型没弹确认窗而脚本却在答"确认" = 行为偏差，任务失败）；
 *  - 有挂起确认 → 只允许 confirm 步骤（模型挂起等答复而脚本想继续说话 = 语义上不可能） */
export interface TaskStep {
  /** 常规用户输入 */
  user?: string;
  /** 确认门答复（'确认' | '授权调优' | 其他任意文本=feedback） */
  confirm?: ConfirmAnswer;
  /** 首步可用的会话历史种子（不执行、只注入 conversation.messages，构造"上一轮聊过"的上下文） */
  seed?: { role: 'user' | 'agent'; bubble: string }[];
}

/** 参数期望的子集：递归子集匹配；数组为"期望项逐个能在实际数组中找到子集匹配"（不比顺序/长度）。
 *  特殊标记：{$type:'string'|'number'|'boolean'|'object'|'array'} 类型断言；{$contains:'子串'} 字符串包含 */
export type ArgsSubset = unknown;

export type Check =
  | {
      /** 模型提出的原始工具调用（确认门放行与否都算）——口径正确率的断言点 */
      id: string; type: 'toolCall'; name: string; argsContains?: ArgsSubset; minTimes?: number; maxTimes?: number; note?: string;
    }
  | {
      /** mock 引擎实收调用（含归一化默认值与 pool 合并）——交付口径的断言点 */
      id: string; type: 'engineCall'; mock: 'backtest' | 'factorAnalysis' | 'factorData'; method: string;
      argsContains?: ArgsSubset; times?: number; minTimes?: number; maxTimes?: number; note?: string;
    }
  | { id: string; type: 'requiredTools'; names: string[]; note?: string }
  | { id: string; type: 'forbiddenTools'; names: string[]; note?: string }
  | { id: string; type: 'replyContains'; text: string; note?: string }
  | { id: string; type: 'replyNotContains'; text: string; note?: string }
  | { id: string; type: 'confirmAsked'; minTimes?: number; note?: string }
  | { id: string; type: 'noConfirm'; note?: string }
  /** 全程未进任何引擎（回测/分析/选股 mock 零调用）——澄清类任务的结构断言 */
  | { id: string; type: 'noEngineRun'; note?: string }
  | { id: string; type: 'cardType'; cardType: string; note?: string };

export interface EvalTask {
  id: string;
  category: TaskCategory;
  title: string;
  steps: TaskStep[];
  checks: Check[];
  /** 交给 judge 模型按 rubric 打分（澄清恰当率/编造判定的软项）；分数进指标卡 */
  judge?: boolean;
  /** 引擎故障注入：前 N 次 run_strategy_backtest 抛 ApiException（授权自纠路径的行为测评） */
  failFirstBacktests?: number;
  /** 用例说明（报告里可见；含"为什么这么期望"的口径依据） */
  rationale?: string;
}

/* ----- 轨迹（harness 采集） ----- */

export interface CapturedToolCall {
  /** 第几轮 agent 调用（0 起） */
  round: number;
  name: string;
  args: unknown;
}

export interface CapturedRound {
  /** 输入消息条数（上下文规模的粗口径） */
  inputMessageCount: number;
  /** 模型本轮输出正文 */
  text: string;
  toolCalls: { name: string; args: unknown }[];
  inputTokens?: number;
  outputTokens?: number;
}

export interface TurnRecord {
  userText: string;
  replyText: string;
  cardType?: string;
  /** 本轮结束时确认门是否挂起（等待用户确认） */
  confirmPending: boolean;
  durationMs: number;
}

export interface RunTrajectory {
  taskId: string;
  runIndex: number;
  rounds: CapturedRound[];
  turns: TurnRecord[];
  /** mock 引擎实收：mock 服务名 + 方法 + 实参（首个参数） */
  engineCalls: { mock: string; method: string; args: unknown }[];
  wallMs: number;
  /** runner 层的执行异常（与"任务失败=检查不过"区分） */
  error?: string;
}
