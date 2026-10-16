import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { RunnableConfig } from '@langchain/core/runnables';
import { Annotation, Command, END, GraphInterrupt, interrupt, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { AgentCard, AgentProgressSink, AgentReply, ChatMessage, Conversation } from '../../types';
import { ApiException } from '../../common/api.exception';
import { appendConversationLog } from '../../common/conversation-log';
import {
  assertStrategyInput,
  BENCHMARKS,
  ClarificationSignal,
  collectAllRefs,
  collectFactorRefs,
  describeFilters,
  describeSellRules,
  describeSortFactors,
  effectiveSortFactors,
  StrategyBacktestInput,
  StrategyBacktestService,
} from '../../core/strategy-backtest.service';
import { describeTimingOverlay } from '../../core/timing';
import { FactorDataService } from '../../core/factor-data.service';
import {
  FactorFieldInfo,
  FactorTableInfo,
  loadTableCatalog,
  loadTableFieldDetails,
  loadTableFields,
} from '../../core/factor-schema';
import { AgentService } from '../agent.service';
import { AGENT_TOOL_SPECS, ListFactorFieldsArgs, ReadFactorDataArgs } from './tool-specs';

/** 工具 → 进度事件里的阶段名（前端可直接展示的中文） */
const TOOL_STAGE: Record<string, string> = {
  list_factor_tables: '查看数据表',
  list_factor_fields: '查看因子字段',
  read_factor_data: '读取因子数据',
  run_strategy_backtest: '策略回测计算',
};

/* ==========================================================
   智能体实现：LangGraph tool-calling，四个工具构成
   "看表 → 看因子 → 读数 / 策略回测出卡片"流程

     agent(GLM, 绑定 4 个工具) ⇄ tools(执行工具)
        │  list_factor_tables        看表清单：tables.md 目录，选出要用的表
        │  list_factor_fields        看因子清单：按表名列表查字段明细，选出要用的因子
        │  read_factor_data          读数据：按 表/因子集合/交易日/证券代码 查库
        │  run_strategy_backtest     策略回测：日频事件内核，产出净值卡片
        ▼
     最终文案（只能引用工具返回的数据）

   - 表目录原文照录注入 system prompt，仅对"数据会话"常驻（执行过任一因子工具的会话，
     见 dataConversations：只进不出，进程重启重置）——数据会话首轮仍走 list_factor_tables
     探索，从下一轮起免探索直达字段/读数/回测；字段知识仍按需经 list_factor_fields 加载；
   - 白名单由服务端两道闸保证：list 工具校验表名，readTable 内部全量校验；
   - 回测参数确认门（human-in-the-loop，LangGraph interrupt + checkpointer）：
     回测执行前 interrupt 暂停并把归一化参数（含默认值标注、排序因子方向/权重）抛给用户确认，
     区间等参数模型可按用户表达换算或合理填写，错了用户在确认面板当场改；
     确认词 approve 直接执行，"授权调优" delegate 本轮内免确认（backtestDelegated 通道），
     其余回复按 feedback 回灌模型（改参重发/放弃回测）；
     checkpointer=MemorySaver（进程内存，重启丢暂停态即自愈），thread 按轮分配、
     快照不跨轮累积——消息真相仍以 conversations 表为准，无双真相问题；
     interrupt 的暂停信号靠抛 GraphInterrupt 实现，guard() 必须放行不可吞；
   - onProgress（SSE 过程事件回调）从图状态迁至 config.configurable：回调函数不可
     序列化进快照，config 不入检查点，节点经 progressSink(config) 取用，功能不变；
   - 工具执行走注册表（toolRunners）按名分发、guard() 统一兜底：
     澄清信号（ClarificationSignal）引导模型向用户提问，ApiException 原因给模型自纠；
   - 回测卡片绕过 LLM：tools 节点把卡片对象写入图状态 card 通道，
     reply() 收尾取出放进 AgentReply，模型只拿指标摘要写文案；
   - 问候/闲聊不调用工具，纯文本回复；
   - 节点级日志：图执行开始、agent 与 tools 节点每次执行的结果（工具调用参数/
     工具回执/最终回复）都打印到日志，长内容截断为预览；
     read_factor_data 回执只记结果形状（行×列），不落原始数据；
     同一轨迹另按会话落盘 logs/conversations/<会话id>.log（common/conversation-log）；
   - 未配置 Key：开发模式，纯文本提示；配置 Key 但 GLM 失败（429/403/超时等）：
     回复仅含失败原因（LlmTextError 语义，与前端展示约定一致）。
   ========================================================== */

/** GLM 调用失败的信号（message 即可读上游原因），由 reply() 捕获后降级为纯报错回复 */
class LlmTextError extends Error {}

/** 工具回执统一形态：result 给模型（进 ToolMessage）；card/backtestFreq 为副作用产物，绕过模型走图状态 */
interface ToolOutcome {
  result: Record<string, unknown>;
  card?: AgentCard;
  backtestFreq?: string;
}

/** 工具执行上下文：随调用传入的图状态只读片段（参数授权标记等） */
interface ToolContext {
  delegated: boolean;
  /** 过程事件出口：回测工具透传给引擎，长阶段（信号预计算/行情拉取）内部发进度 */
  onProgress?: AgentProgressSink;
}

/* ----- LangGraph 状态定义 -----
 * StateGraph 的"通道"（channel）声明：图中每个节点读写同一个状态对象，
 * 节点返回的部分字段会按这里声明的规则合并回状态，驱动图流转。
 *
 * 通道的三种写法：
 *   Annotation<T>                    单值通道——不声明 reducer，节点返回即整体覆盖
 *                                    （LangGraph 默认 last-write-wins）；
 *   Annotation<T>({ reducer })       归并通道——节点返回的增量用 reducer(旧值, 新值) 合并；
 *   default: () => 初值              图启动（invoke）时未提供该字段则取 default()。
 */
const StrategyGraphState = Annotation.Root({
  /* 会话 id：reply() 发起图执行时一次性写入（invoke 的初始状态里带上），图中节点只读——
     工具执行时用它定位会话，未来需要会话级数据时从这里取 */
  conversationId: Annotation<string>,
  /* 当前用户消息原文：与 conversationId 同样入口写入一次、节点只读；
     独立成通道是为了把"用户说了什么"与消息流区分开，避免工具节点去 messages 里反查 */
  userText: Annotation<string>,
  /** 回测交易频率：记录用户期望的调仓频率（如 "日频"、"每2周"），图中节点读写；无节点写入时为 undefined。
   *  注意：LangGraph state 只在一次图执行内存活，跨轮沿用需另接会话存储（暂未接线） */
  backtestFreq: Annotation<string>,
  /** 回测产物卡片：tools 节点执行 run_equal_weight_backtest 成功时写入，reply() 收尾取出放进
   *  AgentReply——卡片绕过 LLM 直达前端，模型只拿指标摘要写文案。
   *  last-write-wins：同一次图执行内多次回测以最后一次为准（作"未指定展示哪次"时的默认卡） */
  card: Annotation<AgentCard | undefined>,
  /** 回合内卡片登记表：card_N → 卡片。tools 节点每成功一次回测登记一张并把编号写进回执；
   *  模型可在最终文案末尾用【展示卡片:card_N】指定展示哪一次（多次回测择优，runGraph 收尾
   *  解析选择，标记行剔除后不展示给用户）；未标记/编号无效 → 落回 card 通道的默认卡。
   *  信任边界：注册表只存后端产出的真卡，模型仅能引用编号，无法注入或篡改卡片内容 */
  cardRegistry: Annotation<Record<string, AgentCard>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  /** 参数授权标记：用户在确认门回复"授权调优"后置 true，本轮（本次图执行）内后续回测免确认——
   *  用户已把参数决定权交给 AI。授权只活一轮，图执行结束即收回，
   *  下一轮回测重新走确认门 */
  backtestDelegated: Annotation<boolean>,
  /** 确认门逐组放行记录（tool_call id）：confirm 节点对同批多个回测调用逐组 interrupt，
   *  用户点"确认"只放行当前组——组 id 记入此通道，tools 节点据此判定该组可执行。
   *  confirm 节点因后续组 interrupt 重跑时，已回答组的决策由 interrupt 恢复机制按序回放，
   *  本通道只在 confirm 正常收尾（goto tools）时随 update 落盘 */
  confirmedCalls: Annotation<string[]>({
    reducer: (a, b) => [...new Set([...a, ...b])],
    default: () => [],
  }),
  /** 确认门拒绝回执（tool_call id → 工具回执 JSON）：用户对某组回复了调整意见（feedback）、
   *  或该组参数未通过归一化/白名单快检（澄清信号/参数错误）——不进引擎，回执经 tools 节点
   *  原样转给模型自行消化（改参重发/放弃） */
  rejectedCalls: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  /** 对话消息流：本图的核心通道。
   *  reducer 必须用 concat 而不是覆盖——agent 节点每轮只返回 1 条 AIMessage（含工具调用
   *  或最终文本），tools 节点返回 N 条 ToolMessage（每个工具调用一条回执），靠 concat
   *  全部追加到序列尾部，"模型 → 工具 → 模型 → …"的完整轨迹才能在一次图执行内
   *  不断累积；下一轮 agent 节点拿到的就是带工具回执的完整上下文，模型据此决定继续
   *  调工具还是收尾作答。
   *  default 为空数组：实际入口由 reply() 注入 [SystemMessage, ...最近6条历史, 当前消息]
   *  作为起点。 */
  messages: Annotation<BaseMessage[]>({
    
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
});

type StrategyGraphStateType = typeof StrategyGraphState.State;

@Injectable()
export class LangGraphAgentService extends AgentService {
  private readonly logger = new Logger(AgentService.name);

  /** 智谱 GLM（OpenAI 兼容协议）；未配置 Key 时为 null，走纯文本提示（开发模式） */
  private readonly llm: ChatOpenAI | null;
  /** 编译后的 LangGraph 工具循环（最小结构类型，避免暴露复杂泛型）；
   *  input 放宽为 object：正常轮传状态对象，确认门 resume 传 Command 实例 */
  private readonly app: {
    invoke(
      input: object,
      config?: { configurable?: Record<string, unknown>; recursionLimit?: number },
    ): Promise<StrategyGraphStateType>;
  } | null;

  /** 数据会话门：执行过任一因子工具的会话 id —— 此类会话的 system prompt 注入表目录原文，
   *  模型免"看表"探索；纯闲聊会话永不注入。只进不出：进入有"调了工具"的可靠信号，退出没有
   *  （某轮闲聊不代表后续不查数），且误留只多几百输入 token、误摘要多付一轮探索；
   *  进程重启清空，各数据会话首轮重新探索即自愈 */
  private readonly dataConversations = new Set<string>();

  /** 回测参数确认门：会话 id → 暂停中的 thread_id。interrupt 挂起时记录，
   *  用户答复（确认/反馈）经 Command(resume) 在同一 thread 恢复；图正常收尾时删除。
   *  进程内存：重启丢失 = 暂停中的确认作废，用户重发回测请求即自愈 */
  private readonly pendingConfirms = new Map<string, string>();

  /** 确认门恢复防重入：恢复正在执行的会话 id 集合（图收尾/失败即移除）。
   *  长回测超过前端 90s 空闲看门狗时用户会按"请稍后重试"提示重发确认——
   *  没有这道闸，第二次 resume 会与第一次并行各跑一遍引擎（双倍打库、两份卡片） */
  private readonly inflightResumes = new Set<string>();

  /** 消息级并发闸：正在跑图的会话 id 集合（图收尾/失败即移除，含确认门恢复）。
   *  同会话第二条"新消息"直接 409——超时重发/手快连点不再并行起第二个图
   *  （双倍打库、双倍配额、两份卡片）。确认门答复不查此闸（挂起的确认必须可答），
   *  其防重入由 inflightResumes 负责 */
  private readonly inflightRuns = new Set<string>();

  /** 保活帧间隔（前端空闲看门狗 90s 的 1/6，一个看门狗窗口喂 6 次；测试可调小） */
  private keepaliveMs = 15_000;

  /** 轮次序号：thread_id = `${conversationId}:${时间戳}:${seq}`，保证进程内唯一 */
  private turnSeq = 0;

  /** 检查点器（进程内存）：支撑 interrupt 暂停-恢复（回测参数确认门）。
   *  thread 按轮分配（见 runGraph），快照不跨轮累积，消息真相仍以 conversations 表为准 */
  private readonly checkpointer = new MemorySaver();

  constructor(
    config: ConfigService,
    private readonly factorData: FactorDataService,
    private readonly backtest: StrategyBacktestService,
  ) {
    super();
    // 漂移检查（启动一次）：tables.md 已登记但 <表名>.md 字典缺失/无字段行的表，提醒补齐
    const catalog = loadTableCatalog();
    if (!catalog.length) {
      this.logger.warn('表目录不可读（SQL/tables.md 缺失或为空），system prompt 目录注入将禁用');
    } else {
      const missing = catalog.filter((t) => (loadTableFields(t.table) ?? new Set<string>()).size === 0);
      if (missing.length) {
        this.logger.warn(`以下表已登记但字段字典缺失或为空: ${missing.map((t) => t.table).join(', ')}`);
      }
    }
    const apiKey = config.get<string>('zhipu.apiKey') ?? '';
    const model = config.get<string>('zhipu.model') ?? 'glm-4-flash';
    const baseURL = config.get<string>('zhipu.baseUrl') ?? 'https://open.bigmodel.cn/api/paas/v4';
    const timeoutMs = Number(config.get<number>('chat.timeoutMs') ?? 20_000);
    const thinking = config.get<string>('zhipu.thinking') ?? 'disabled';

    if (apiKey.trim()) {
      this.llm = new ChatOpenAI({
        apiKey,
        modelName: model,
        temperature: 0.1,
        // 推理模型（如 glm-5.3-flash）的 reasoning_content 与正文/工具调用共用 max_tokens，
        // 给足余量，避免思考爆发时正文被截成空
        maxTokens: 16_384,
        timeout: timeoutMs,
        configuration: { baseURL },
        // 默认关闭思考（GLM thinking）：单轮延迟更低，且消除思考爆发吃穿 max_tokens 导致正文为空；
        // ZHIPU_THINKING=enabled 可开回
        ...(thinking === 'enabled' ? {} : { modelKwargs: { thinking: { type: 'disabled' } } }),
      });
      this.app = this.buildGraph(
        this.llm.bindTools([...AGENT_TOOL_SPECS]) as unknown as {
          invoke(messages: BaseMessage[]): Promise<unknown>;
        },
      );
    } else {
      this.llm = null;
      this.app = null;
    }
  }

  private buildGraph(agent: { invoke(messages: BaseMessage[]): Promise<unknown> }) {
    return new StateGraph(StrategyGraphState)
      .addNode('agent', async (state: StrategyGraphStateType, config: RunnableConfig) => {
        const output = (await agent.invoke(state.messages)) as AIMessage;
        const calls = output.tool_calls ?? [];
        const line = calls.length
          ? `agent节点 → 工具调用 ${calls.map((c) => `${c.name}(${toLogPreview(c.args)})`).join(' ; ')}`
          : `agent节点 → 最终回复: ${toLogPreview(extractText(output))}`;
        this.logger.log(line);
        appendConversationLog(state.conversationId, line);
        // 进度事件：与日志同一埋点，参数只带短预览（前端示意用）
        for (const c of calls) {
          const stage = TOOL_STAGE[c.name] ?? c.name;
          progressSink(config)?.({ type: 'tool_call', name: c.name, stage, args: toEventPreview(c.args) });
        }
        return { messages: [output] };
      })
      .addNode('tools', async (state: StrategyGraphStateType, config: RunnableConfig) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        // 会话门：任一工具调用（含失败重试）即证明是数据会话，后续轮注入表目录免探索
        this.dataConversations.add(state.conversationId);
        const additions: BaseMessage[] = [];
        let card: AgentCard | undefined;
        let backtestFreq: string | undefined;
        // 回合内卡片登记表：编号 = 既有张数 + 1，跨多次 tools 节点执行经 reducer 累积
        const registry = { ...(state.cardRegistry ?? {}) };
        for (const call of last.tool_calls ?? []) {
          // 确认门拒绝的调用（feedback / 参数快检不过）不进引擎：回执已由 confirm 节点生成，原样转给模型
          const rejected = state.rejectedCalls?.[call.id ?? ''];
          if (rejected !== undefined) {
            additions.push(new ToolMessage({ content: rejected, tool_call_id: call.id ?? '' }));
            this.logger.log(`tools节点 ${call.name}(${toLogPreview(call.args)}) => 确认门拒绝回执透传`);
            continue;
          }
          const runner = this.toolRunners[call.name];
          const outcome = runner
            ? await this.guard(() =>
                runner(call.args, {
                  // 回测调用走到 tools 必已获授权（confirm 节点放行/委托）——标记仅供执行器记录口径
                  delegated: state.backtestDelegated === true || state.confirmedCalls.includes(call.id ?? ''),
                  // 过程事件出口：回测工具透传给引擎，长阶段内部发批次进度（防 90s 空闲看门狗误断）
                  onProgress: progressSink(config),
                }),
              )
            : { result: { error: `未知工具: ${call.name}` } };
          additions.push(new ToolMessage({ content: JSON.stringify(outcome.result), tool_call_id: call.id ?? '' }));
          if (outcome.card) {
            card = outcome.card; // 回测失败时无卡片，保持上一次的值也无妨（默认展示卡取最后一次成功）
            const cardId = `card_${Object.keys(registry).length + 1}`;
            registry[cardId] = outcome.card;
            // 回执带编号：模型可在最终文案用【展示卡片:card_N】择优指定展示哪一次（多次回测场景）
            outcome.result['卡片编号'] = cardId;
          }
          if (outcome.backtestFreq) backtestFreq = outcome.backtestFreq;
          const line = `tools节点 ${call.name}(${toLogPreview(call.args)}) => ${this.toolResultPreview(call.name, outcome.result)}`;
          this.logger.log(line);
          appendConversationLog(state.conversationId, line);
          progressSink(config)?.({
            type: 'tool_result',
            name: call.name,
            stage: TOOL_STAGE[call.name] ?? call.name,
            ok: !(outcome.result as { error?: unknown }).error,
            detail: this.toolEventDetail(call.name, outcome.result),
          });
        }
        return {
          messages: additions,
          ...(card ? { card } : {}),
          ...(backtestFreq ? { backtestFreq } : {}),
          cardRegistry: registry,
        };
      })
      .addNode('confirm', async (state: StrategyGraphStateType) => this.execConfirmBacktest(state))
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', (state: StrategyGraphStateType) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        if (!last.tool_calls?.length) return END;
        // 有未获授权（未委托且未逐组确认）的回测调用 → 先走确认门；其余直接执行
        const needsConfirm = last.tool_calls.some(
          (c) =>
            c.name === 'run_strategy_backtest' &&
            state.backtestDelegated !== true &&
            !state.confirmedCalls.includes(c.id ?? ''),
        );
        return needsConfirm ? 'confirm' : 'tools';
      })
      .addEdge('tools', 'agent')
      .compile({ checkpointer: this.checkpointer });
  }

  /** 运行智能体：文本回复必给；本次执行跑成过等权回测则附带净值卡片（卡片绕过 LLM） */
  async reply(conversation: Conversation, userText: string): Promise<AgentReply> {
    return this.runGraph(conversation, userText, undefined);
  }

  /** reply 的流式形态：节点级过程事件（工具开始/结果、失败）经 onProgress 推送，
   *  返回值与 reply() 完全一致——事件只是附加推送，最终结果以返回值为准 */
  async replyStream(
    conversation: Conversation,
    userText: string,
    routeText: string,
    onProgress: AgentProgressSink,
  ): Promise<AgentReply> {
    void routeText; // 与 reply 同口径：路由上下文当前未参与模型输入
    return this.runGraph(conversation, userText, onProgress);
  }

  private async runGraph(conversation: Conversation, userText: string, onProgress?: AgentProgressSink): Promise<AgentReply> {
    // ① 未配置 Key：开发模式，纯文本提示
    if (!this.app || !this.llm) {
      return { text: '当前为开发模式（未配置智谱 Key），因子查询功能需配置 ZHIPU_API_KEY 后使用。' };
    }

    // ② 确认门恢复：会话有挂起的回测确认 → 本条消息是决策不是新提问，在同一 thread 上 resume
    const pendingThread = this.pendingConfirms.get(conversation.id);
    // 防重入闸：同一确认的上一轮恢复仍在执行（图未收尾）→ 拒绝再次恢复。
    // 必须在下方 try 之外抛（catch 会把一切异常吞成文本回复），ApiException 直接穿透为 SSE error 帧 → 前端 toast
    if (pendingThread && this.inflightResumes.has(conversation.id)) {
      this.logger.warn(`确认门重复恢复被拦 会话=${conversation.id} thread=${pendingThread}`);
      appendConversationLog(conversation.id, '确认门重复恢复被拦（上一轮仍在执行中）');
      throw new ApiException('BACKTEST_RUNNING', 409, '上一轮回测正在执行中，请等待本轮结果返回，无需重复确认');
    }
    // 消息级并发闸：同会话已有消息在图里跑 → 新提问 409。必须在此处（下方吞异常的 try
    // 之外）抛，ApiException 才能穿透为 SSE error 帧 → 前端 toast
    if (!pendingThread && this.inflightRuns.has(conversation.id)) {
      this.logger.warn(`并发消息被拦 会话=${conversation.id}（上一条消息仍在执行中）`);
      appendConversationLog(conversation.id, '并发消息被拦（上一条消息仍在执行中）');
      throw new ApiException(
        'CONVERSATION_BUSY',
        409,
        '上一条消息还在执行中，请等它出结果后再发；结果稍后会出现在会话里，无需重发',
      );
    }

    this.inflightRuns.add(conversation.id);
    // 保活帧：GLM 思考/工具执行都可能数分钟无事件，前端 90s 空闲看门狗会把"活着但慢"
    // 误判成死链路掐线重发。keepalive 走与进度事件同一条 onProgress 管道，前端每次收到
    // 字节都重置看门狗时钟；仅流式路径启用（同步 reply 无 onProgress 可发）
    const keepalive = onProgress
      ? setInterval(() => {
          try {
            onProgress({ type: 'keepalive' });
          } catch {
            /* 客户端已断开：写失败静默（与 controller write 的容错口径一致） */
          }
        }, this.keepaliveMs)
      : null;
    try {
      // ③ tool-calling 主链路：thread 按轮分配，快照只活一轮（消息真相仍以 conversations 表为准）
      const threadId = `${conversation.id}:${Date.now()}:${this.turnSeq++}`;
      if (pendingThread) {
        this.inflightResumes.add(conversation.id);
        try {
          return await this.resumeConfirm(conversation, userText, pendingThread, onProgress);
        } catch (error) {
          // fail-open：恢复失败（GLM 报错等）清掉挂起映射退回普通对话，不把会话卡死在确认模式
          this.pendingConfirms.delete(conversation.id);
          this.logger.warn(`确认门恢复失败，已退出确认模式 会话=${conversation.id}: ${String(error)}`);
          throw error;
        } finally {
          this.inflightResumes.delete(conversation.id);
        }
      }
      this.logger.log(`图执行开始 会话=${conversation.id} thread=${threadId} 提问: ${toLogPreview(userText)}`);
      appendConversationLog(conversation.id, `提问: ${toLogPreview(userText)}`);
      onProgress?.({ type: 'start' });
      // 入口即授权：用户消息精确为"授权调优"（前端授权按钮回发）→ 本次图执行以已授权状态启动，
      // 模型响应授权而发起的多组回测全部免确认。与确认门 resume 的 delegate 同语义：授权只活本次图执行。
      const entryDelegated = userText.trim() === '授权调优';
      const state = await this.app.invoke(
        {
          conversationId: conversation.id,
          userText,
          ...(entryDelegated ? { backtestDelegated: true } : {}),
          messages: this.prepareMessages(conversation, userText),
        },
        { configurable: { thread_id: threadId, onProgress }, recursionLimit: 15 },
      );
      return this.collectReply(state, conversation.id, threadId);
    } catch (error) {
      const reply = this.errorReply(error, conversation.id);
      onProgress?.({ type: 'error', message: reply.text });
      return reply;
    } finally {
      if (keepalive) clearInterval(keepalive);
      this.inflightRuns.delete(conversation.id);
    }
  }

  /** 确认门恢复：确认词 → approve 直接执行；其余一切回复 → feedback 交模型消化
   *  （调整参数重发会再次 interrupt，继续挂起等下一轮答复）。恢复后若图正常收尾，
   *  collectReply 会清掉挂起映射 */
  private async resumeConfirm(
    conversation: Conversation,
    userText: string,
    threadId: string,
    onProgress?: AgentProgressSink,
  ): Promise<AgentReply> {
    /* 决策定死为精确匹配：前端确认门/优化建议弹窗的按钮回发固定指令
     * （"确认"=执行本组；"授权调优"=连续多组对比免确认），
     * 其余一切回复一律按自然语言反馈交模型消化——不做任何模糊匹配 */
    const trimmed = userText.trim();
    const decision =
      trimmed === '授权调优'
        ? { action: 'delegate' as const }
        : trimmed === '确认' || trimmed === '确认执行'
          ? { action: 'approve' as const }
          : { action: 'feedback' as const, text: userText };
    this.logger.log(
      `确认门恢复 会话=${conversation.id} thread=${threadId} 决策=${decision.action} 答复: ${toLogPreview(userText)}`,
    );
    appendConversationLog(conversation.id, `确认门恢复 决策=${decision.action}: ${toLogPreview(userText)}`);
    onProgress?.({ type: 'start' });
    const state = await this.app!.invoke(new Command({ resume: decision }), {
      configurable: { thread_id: threadId, onProgress },
      recursionLimit: 15,
    });
    return this.collectReply(state, conversation.id, threadId);
  }

  /** invoke 结果收尾：中断 → 记挂起映射、返回参数确认文案；正常 → 卡片择优出回复并清挂起映射 */
  private collectReply(state: StrategyGraphStateType, conversationId: string, threadId: string): AgentReply {
    const interrupted = (
      state as { __interrupt__?: Array<{ value: { params?: Record<string, string> } }> }
    ).__interrupt__;
    if (interrupted?.length) {
      this.pendingConfirms.set(conversationId, threadId);
      const params = interrupted[0]?.value?.params ?? {};
      this.logger.log(`回测参数确认挂起 会话=${conversationId} thread=${threadId} 参数=${toLogPreview(params)}`);
      appendConversationLog(conversationId, `回测参数确认挂起: ${toLogPreview(params)}`);
      return { text: formatConfirmText(params) };
    }
    this.pendingConfirms.delete(conversationId);
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const text = extractText(last).trim();
    if (!text) throw new LlmTextError('返回内容为空');
    // 多次回测择优：模型用【展示卡片:card_N】指定展示哪一次；未指定/编号无效 → 最后一次成功的
    const picked = applyCardSelection(text, state.cardRegistry ?? {}, state.card);
    if (picked.markerId) {
      this.logger.log(
        `最终展示卡片: ${picked.markerId}${picked.card ? '' : '（编号无效，回落默认）'}，文案标记行已剔除`,
      );
    }
    return picked.card ? { text: picked.text, card: picked.card } : { text: picked.text };
  }

  /** GLM 失败 → 回复仅含失败原因（与前端展示约定一致），并同步记入会话日志 */
  private errorReply(error: unknown, conversationId: string): AgentReply {
    let text: string;
    if (error instanceof LlmTextError) {
      this.logger.warn(`GLM 调用失败: ${error.message}`);
      text = llmErrorText(error.message);
    } else {
      const reason = this.extractUpstreamMessage(error);
      this.logger.warn(`GLM 工具链路异常: ${reason}`);
      text = llmErrorText(reason);
    }
    appendConversationLog(conversationId, `执行失败 → ${text}`);
    return { text };
  }

  /* ----- 工具执行：注册表 + 统一兜底 -----
   * 每个工具一个执行器（名称 → 执行器），返回统一形态 ToolOutcome；
   * 异常不在各执行器内处理，统一由 guard() 分流（澄清信号 / ApiException / 意外错误）。
   * 新增工具 = tool-specs.ts 加一条 schema + 这里加一行注册，不动图结构。 */

  /** 工具回执统一形态：result 给模型（进 ToolMessage）；card/backtestFreq 为副作用产物，绕过模型 */
  private readonly toolRunners: Record<string, (args: unknown, ctx: ToolContext) => Promise<ToolOutcome>> = {
    list_factor_tables: async () => ({ result: this.execListTables() }),
    list_factor_fields: async (args) => ({ result: this.execListFields(args as ListFactorFieldsArgs) }),
    read_factor_data: async (args) => ({ result: await this.execReadData(args as ReadFactorDataArgs) }),
    run_strategy_backtest: async (args, ctx) => this.execRunBacktest(args as StrategyBacktestInput, ctx),
  };

  /** 统一兜底：澄清信号 → 指引模型向用户提问；ApiException → 原因给模型自纠；其他 → 通用失败并记日志。
   *  例外：GraphInterrupt（确认门的暂停信号，靠抛错实现）必须原样穿透，吞掉=确认门失效 */
  private async guard(run: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof GraphInterrupt) throw error;
      if (error instanceof ClarificationSignal) {
        return { result: error.guide };
      }
      const msg = error instanceof ApiException ? error.message : '工具执行失败，请稍后重试';
      if (!(error instanceof ApiException)) this.logger.warn(`工具执行异常: ${String(error)}`);
      return { result: { error: msg } };
    }
  }

  private execListTables(): Record<string, unknown> {
    const catalog = loadTableCatalog();
    if (!catalog.length) {
      return { error: '字段字典目录（SQL/tables.md）不可读或为空，无法列出数据表' };
    }
    return {
      tables: catalog,
      提示: '请从中选出要用的数据表，再调用 list_factor_fields 查看其因子字段',
    };
  }

  private execListFields(args: ListFactorFieldsArgs): Record<string, unknown> {
    const tables = Array.isArray(args.tables)
      ? args.tables.map((t) => String(t).trim()).filter(Boolean)
      : [];
    if (!tables.length) {
      return { error: 'tables 参数不合法：需要至少一个表名，表名来自 list_factor_tables 的返回' };
    }

    const found: { table: string; fields: FactorFieldInfo[] }[] = [];
    const notFound: string[] = [];
    for (const table of tables) {
      const details = loadTableFieldDetails(table);
      if (details === undefined) notFound.push(table);
      else found.push({ table, fields: details });
    }

    const result: Record<string, unknown> = { tables: found };
    if (notFound.length) {
      result.notFound = notFound;
      result.提示 =
        `以下表名不在字段字典中: ${notFound.join(', ')}。` +
        `可用表: ${loadTableCatalog().map((c) => c.table).join(', ') || '（无）'}`;
    }
    return result;
  }

  private async execReadData(args: ReadFactorDataArgs): Promise<Record<string, unknown>> {
    const table = String(args.table ?? '').trim();
    const fields = Array.isArray(args.fields) ? args.fields.map((f) => String(f).trim()).filter(Boolean) : [];
    const date = String(args.date ?? '').trim();
    const security = String(args.security ?? '').trim();
    if (!table || !fields.length || !date || !security) {
      return {
        error:
          '参数不完整：需要 table（表名）、fields（因子字段名数组）、date（纯数字 YYYYMMDD）、security（如 000002.XSHE）。' +
          '表与字段名请先通过 list_factor_tables / list_factor_fields 获取',
      };
    }

    // 异常交给 guard()：ApiException（格式/白名单/连接错误）原样把 message 给模型，便于它自行纠正
    const rows = await this.factorData.readTable({ table, fields, date, security });
    if (!rows.length) {
      return {
        ok: true,
        数据: [],
        提示: `查询成功但无数据行：${table} 中 ${security} 在 ${date} 可能没有记录，请如实告知用户，不要编造`,
      };
    }
    return {
      ok: true,
      数据: rows,
      提示: '请据此用不超过 90 字写最终回复，只能引用返回数据，不要编造，不输出 JSON',
    };
  }

  /** 回测确认门节点（confirm）：确认与执行分离后的把关侧——只做参数归一化、白名单快检与
   *  interrupt 逐组确认，零副作用（节点被 LangGraph 重跑任意次都不会重复跑引擎）。
   *
   *  同批多个回测调用逐组处理：
   *    - 已委托（backtestDelegated）或已逐组确认（confirmedCalls）→ 跳过；
   *    - interrupt 挂起等用户决策，resume 按调用顺序逐组回放历史决策——因此本节点重跑时
   *      "已回答的组"直接拿到历史值继续，只有未回答的组真正挂起等待；
   *    - approve → 该组 id 记入 confirmedCalls（只放行这一组）；
   *    - delegate → 置 backtestDelegated（本批后续 + 本轮后续全放行）；
   *    - feedback / 归一化失败 / 白名单不过 → 该组不进引擎，回执记入 rejectedCalls 交模型消化。
   *  全部组处理完 → Command(goto="tools")：工具执行自此不再被打断，天然幂等。 */
  private async execConfirmBacktest(state: StrategyGraphStateType) {
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const confirmed: string[] = [];
    const rejections: Record<string, string> = {};
    let delegated = state.backtestDelegated === true;

    for (const call of last.tool_calls ?? []) {
      if (call.name !== 'run_strategy_backtest') continue;
      if (delegated || state.confirmedCalls.includes(call.id ?? '')) continue;
      this.logger.log(`confirm节点 回测确认 ${call.id}: ${toLogPreview(call.args)}`);
      try {
        const p = assertStrategyInput(call.args as StrategyBacktestInput);
        // 白名单 + 区间快检都在 interrupt 之前：字段不存在/区间超界的提案先打回模型自纠，
        // 不让用户确认一个注定失败的提案（区间报错带可用范围，模型改参重发只需用户确认一次）
        this.backtest.preflight(collectAllRefs(p));
        await this.backtest.checkRange(p);
        const sort = effectiveSortFactors(p.sortFactors);
        const decision = interrupt({
          type: 'confirm_backtest',
          params: {
            回测区间: `${p.startDate}~${p.endDate}`,
            股票池: p.securityIds ? `${p.securityIds.length} 只` : '全市场',
            调仓间隔: `每 ${p.rebalanceIntervalDays} 个交易日`,
            每期持仓: `${p.maxPositions} 只 × ${p.idealPositionPct}%${isUserSet(call.args?.maxPositions) ? '' : '（默认）'}`,
            排序因子: describeSortFactors(sort.factors) + (sort.usedDefault ? '【默认追加】' : ''),
            过滤因子: describeFilters(p.entryFilters),
            卖出规则: describeSellRules(p.sellRules),
            ...(p.timingOverlay ? { 择时规则: describeTimingOverlay(p.timingOverlay) } : {}),
            ...(p.rebalanceIntervalDays === 0
              ? { 交易模型: `条件触发（模型 Ⅱ）· 偏离带 ±${p.positionDeviatePct}%` }
              : {}),
            '初始资金/费用': `${p.initialCapital} 元 · 单边 ${(p.feeRate * 100).toFixed(2)}%${isUserSet(call.args?.feeRate) ? '' : '（默认）'}`,
            业绩基准: `${BENCHMARKS[p.benchmark].name}${isUserSet(call.args?.benchmark) ? '' : '（默认）'}`,
          },
        }) as
          | { action: 'approve' }
          | { action: 'delegate' }
          | { action: 'feedback'; text: string };

        if (decision.action === 'feedback') {
          rejections[call.id ?? ''] = JSON.stringify({
            已取消: `用户未确认本次回测，其回复：「${decision.text}」`,
            行动: '请结合用户反馈决定：调整参数后重新发起回测（将再次请用户确认），或不再回测、直接回应用户',
          });
          this.logger.log(`confirm节点 ${call.id} → feedback，该组取消`);
          continue;
        }
        if (decision.action === 'delegate') {
          delegated = true; // 本批后续 + 本轮（本次图执行）后续全放行
          this.logger.log('用户授权调优：本批后续与本轮后续回测免确认');
          continue;
        }
        confirmed.push(call.id ?? '');
        this.logger.log(`confirm节点 ${call.id} → approve，放行本组`);
      } catch (error) {
        // interrupt 的暂停信号必须原样穿透，吞掉 = 确认门失效
        if (error instanceof GraphInterrupt) throw error;
        if (error instanceof ClarificationSignal) {
          rejections[call.id ?? ''] = JSON.stringify(error.guide);
          continue;
        }
        const msg = error instanceof ApiException ? error.message : '工具执行失败，请稍后重试';
        if (!(error instanceof ApiException)) this.logger.warn(`confirm节点 参数快检异常: ${String(error)}`);
        rejections[call.id ?? ''] = JSON.stringify({ error: msg });
      }
    }

    return new Command({
      goto: 'tools',
      update: {
        ...(confirmed.length ? { confirmedCalls: confirmed } : {}),
        ...(Object.keys(rejections).length ? { rejectedCalls: rejections } : {}),
        ...(delegated && state.backtestDelegated !== true ? { backtestDelegated: true } : {}),
      },
    });
  }

  /** 策略回测执行（tools 侧）：到达时参数必已过确认门（confirm 节点放行/委托）——
   *  这里只做归一化复核与引擎调用，不再含任何 interrupt，节点重跑也不会重复建仓扣费 */
  private async execRunBacktest(args: StrategyBacktestInput, ctx: ToolContext): Promise<ToolOutcome> {
    const p = assertStrategyInput(args);
    this.backtest.preflight(collectAllRefs(p));

    let output;
    try {
      output = await this.backtest.runStrategyBacktest(p, ctx.onProgress);
    } catch (error) {
      // 已授权回测的引擎失败：错误交模型自纠（如区间超出数据范围时改用表内可用区间），
      // 授权仍有效，模型可改参重发；回执带"行动"指引——失败必须告知用户，不许默默重试装作没发生
      if (ctx.delegated && error instanceof ApiException) {
        this.logger.warn(`[授权调试] 已授权回测失败，错误交模型自纠: ${error.message}`);
        return {
          result: {
            error: error.message,
            行动: '先向用户如实说明本组回测失败及原因（不要默默重试装作没发生），再按失败原因调整参数重新发起；' +
              '调整说明与后续建议在最终回复中一并给出，结尾按优化建议规则提示可回复"授权调优"',
          },
        };
      }
      throw error;
    }
    return {
      result: {
        ...output.summary,
        ...(ctx.delegated ? { 授权模式: '参数已授权，本轮内继续回测无需确认；连续多组回测整体耗时较长，完成后请汇总对比、择优推荐' } : {}),
      },
      card: output.card,
      backtestFreq: `每${p.rebalanceIntervalDays}个交易日`,
    };
  }

  /** 工具回执的日志形态：read_factor_data 不落原始数据，只报结果形状；其余工具原样截断预览 */
  private toolResultPreview(toolName: string, result: unknown): string {
    if (toolName !== 'read_factor_data') return toLogPreview(result);
    const r = (result ?? {}) as Record<string, unknown>;
    if (!Array.isArray(r.数据)) return toLogPreview(result); // 参数不完整/查询失败等小对象，原样即可
    const rows = r.数据 as Record<string, unknown>[];
    const cols = rows.length ? Object.keys(rows[0]).length : 0;
    return `成功 形状=${rows.length}行×${cols}列`;
  }

  /** 工具回执 → 进度事件的一行摘要（回测报关键指标、读数报行数、其余报规模或失败原因） */
  private toolEventDetail(name: string, result: unknown): string {
    const r = (result ?? {}) as Record<string, unknown>;
    if (typeof r.error === 'string') return '失败：' + r.error.slice(0, 60);
    if (name === 'read_factor_data' && Array.isArray(r.数据)) {
      return r.数据.length ? `返回 ${r.数据.length} 行` : '无数据行';
    }
    if (name === 'run_equal_weight_backtest') {
      return `${r.年化收益 ?? ''}，回撤 ${r.最大回撤 ?? ''}，换手 ${r.年化换手单边 ?? ''}`;
    }
    if (name === 'list_factor_tables' && Array.isArray(r.tables)) return `${r.tables.length} 张表`;
    if (name === 'list_factor_fields' && Array.isArray(r.tables)) return `${r.tables.length} 张表的字段明细`;
    return '完成';
  }

  /* ----- 消息构造 ----- */

  private prepareMessages(conversation: Conversation, userText: string): BaseMessage[] {
    const history = conversation.messages.slice(-6).map((m: ChatMessage) =>
      m.role === 'agent' ? new AIMessage({ content: m.bubble }) : new HumanMessage({ content: m.bubble }),
    );

    return [
      new SystemMessage({ content: this.buildSystemPrompt(conversation.id) }),
      ...history,
      new HumanMessage({ content: userText }),
    ];
  }

  /** system prompt：数据会话（执行过任一因子工具，见 dataConversations）在提示末尾注入表目录
   *  原文，模型免"看表"探索直达字段/读数/回测；目录现读现拼（微秒级读盘），字典更新即时生效；
   *  纯闲聊会话或目录不可读 → 回退 list_factor_tables 探索指令（工具保留作兜底） */
  private buildSystemPrompt(conversationId: string): string {
    const catalog = this.dataConversations.has(conversationId) ? loadTableCatalog() : [];
    const flow = catalog.length
      ? '工具流程：数据表目录已附在本提示末尾，直接从中选定数据表，再调 list_factor_fields 查看该表的因子字段' +
        '（表名只能来自目录，字段名只能来自 list_factor_fields 的返回，禁止凭记忆编造），' +
        '然后按需调用 read_factor_data 查单点数据、或 run_strategy_backtest 跑策略回测——各工具的参数含义与约束以工具 schema 为准。'
      : '工具流程：先 list_factor_tables 看有哪些表、list_factor_fields 看因子字段（表名/字段名只能来自这两个工具的返回，禁止凭记忆编造），' +
        '再按需调用 read_factor_data 查单点数据、或 run_strategy_backtest 跑策略回测——各工具的参数含义与约束以工具 schema 为准。';
    const system = [
      // 模型不知道当前时间："最近两年/今年/去年"等相对时间表达靠这行换算成具体日期，
      // 换算结果经确认门（interrupt 参数清单）展示给用户，错了用户可当场纠正
      todayLine(),
      '你是"因子智投（AlphaSage）"多因子选股智能体，面向专业投资者，基于本地因子数据库回答数据问题。',
      flow,
      '回复规则：',
      '- 最终回复不超过 90 字，只能引用工具返回的数据，严禁编造数字或个股，不输出 JSON，结尾用短句提醒不构成投资建议；',
      '- 工具回执含"需要澄清"时，按其中"行动"指引向用户提问，不要当作错误转述；',
      '- run_strategy_backtest 的回测区间（startDate/endDate）与调仓间隔（rebalanceIntervalDays）为必填：区间按用户说过的照传' +
        '（相对时间如"最近两年"按系统提示的今天日期换算，完全没提时填合理区间如近三年，不要反问）；' +
        '调仓间隔用户没说时必须先向用户询问，禁止自行假设；' +
        'maxPositions 与业绩基准用户没说时可用引擎默认值，但最终文案要注明"默认"；' +
        'sortFactors 缺省时引擎自动用默认 20 日动量排序（值大优），提案前请向用户说明这一点；' +
        '同一因子既做过滤又做排序时，entryFilters 与 sortFactors 两处都要传；',
      '- 大盘择时：用户表达总仓位控制意图（如"跌破某点位就空仓""放量才满仓""熊市半仓"）时组装 timingOverlay：' +
        '字段必须先经 list_factor_fields 确认存在（当前可用 mkt_idxd 的 CLOSE_INDEX/CHG_PCT/TURNOVER_VALUE）；' +
        '指数没说默认上证、阈值票数没说默认全部、熊市仓位没说默认空仓（提案中注明"默认"）；' +
        '字典暂无均线/金叉类字段，用户提出时如实告知暂不支持，引导改用点位/涨跌幅/量能条件；' +
        '择时只影响总仓位，选股条件照常生效；',
      '- 触发模式（模型 Ⅱ）：用户说"不按月调仓，满足条件就买""偏离 X% 再平衡"时传 rebalanceIntervalDays=0，' +
        '必须同时传 positionDeviatePct（偏离带宽 %，没说默认 20，需注明"默认"）且预声明触发域 securityIds；' +
        '触发模式的卖出规则不支持字段条件与排名跌出，如实告知；' +
        '调仓模式下 positionDeviatePct 语义不同：可选的择时拉回阈值 %（默认 1），' +
        '用户表达"偏离目标仓位超 X% 就拉回"时才传，没提不要主动传；',
      '- run_strategy_backtest 执行前系统会请用户确认参数：收到"已取消"回执时，' +
        '结合用户反馈调整参数后重新发起（会再次请用户确认），或放弃回测直接回应用户，' +
        '不要声称回测已开始或编造回测结果；',
      '- 回测执行失败的组必须在最终回复里如实告知用户：哪一组（参数摘要）、失败原因、建议的调整方向，' +
        '禁止默默重试后装作没有失败——失败后的重试也要先说明原因和调整思路；' +
        '失败原因与调整方向本身就是优化建议，按优化建议规则结尾提示可回复"授权调优"；',
      '- 用户要求优化/调参/多方案对比时，可连续多次调用 run_strategy_backtest：' +
        '首次仍会请用户确认，用户回复"授权调优"后本轮内免确认（回执含"授权模式"注明）；' +
        '连续多组时保持用户已确认的关键参数不变（securityIds 股票池、区间、资金、基准），只按建议调整要对比的维度；' +
        '因子阈值必须落在字段真实值域内（拿不准时先用 read_factor_data 抽样看值域再定阈值），禁止拍脑袋填大数；' +
        '结束时对比各次指标择优推荐，用【展示卡片:card_N】指定展示最优的一次；' +
        '给出优化建议后，结尾固定加一句：回复"授权调优"可按建议连续多组回测对比择优（前端会渲染授权按钮）；',
      '- 本回合跑了多次回测时，每份回执带「卡片编号」：按用户意图选最符合的一次（如优化场景选指标最优的），在回复最末尾单独一行写【展示卡片:card_N】指定展示哪次（该行不会展示给用户）；只回测了一次则不写；',
      '- 查询无数据行时如实告知，不要编造；',
      '- 与因子数据无关的问候或闲聊：直接简短回复（不超过 90 字），不要调用工具。',
    ].join('\n');
    return catalog.length ? `${system}\n\n${formatTableCatalog(catalog)}` : system;
  }

  /** 从 LangChain 异常中提取上游可读原因（首行，截断到 120 字），如 "429 余额不足或无可用资源包,请充值." */
  private extractUpstreamMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error);
    const firstLine = raw
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? '未知错误';
    return `调用返回「${firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine}」`;
  }
}

/** 今天日期行（注入 system prompt）：模型没有当前时间感知，相对时间表达
 *  （"最近两年""今年"）全靠这行换算成纯数字区间，免去反问用户的弯路 */
function todayLine(): string {
  const d = new Date();
  const ymd =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `今天是 ${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}（YYYYMMDD: ${ymd}）。` +
    `用户用相对时间（如"最近两年""今年"）表达区间时，据此换算为具体 YYYYMMDD 起止，不要反问。`;
}

/** 确认挂起 → 用户文案：逐项列出将执行的参数（与卡片 params 同源），请求确认或改参 */
function formatConfirmText(params: Record<string, string>): string {
  const lines = Object.entries(params).map(([k, v]) => `- ${k}：${v}`);
  return [
    '将按以下参数执行策略回测：',
    ...lines,
    '',
    '回复"确认"开始回测；如需调整，直接回复要改的参数（如"改成每10个交易日调仓"、"区间用近一年"、"改成按 REVS20 值小优排序"）；',
    '如需 AI 连续多次回测自动调优，回复"授权调优"（本轮内免确认；连续计算多组参数，整体耗时会明显长于单次回测）。',
  ].join('\n');
}

/** 从 config 取过程事件接收端：onProgress 已从图状态迁至 config.configurable——
 *  回调函数不可序列化进 checkpointer 快照，config 本身不入检查点 */
function progressSink(config: RunnableConfig | undefined): AgentProgressSink | undefined {
  const c = config?.configurable as { onProgress?: AgentProgressSink } | undefined;
  return c?.onProgress;
}

/** 入参字段是否由模型显式提供（确认清单里决定"（默认）"标注） */
function isUserSet(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/** 表目录 → system prompt 目录块：原文照录（表名/中文名/描述/唯一键），不压缩改写——
 *  模型选表依据与 list_factor_tables 回执同源同文，注入不损失精度 */
export function formatTableCatalog(catalog: FactorTableInfo[]): string {
  const lines = catalog.map((t) => {
    const key = t.uniqueKey ? ` 唯一键: ${t.uniqueKey}` : '';
    return `- ${t.table}（${t.title}）：${t.description}${key}`;
  });
  return ['【数据表目录】（与 list_factor_tables 返回一致，无需再调用该工具）', ...lines].join('\n');
}

/** 多次回测择优：从最终文案解析【展示卡片:card_N】标记（兼容全角/半角冒号与空格）——
 *  命中注册表 → 用该卡并剔除标记行（不展示给用户）；编号无效 → 落回默认卡但同样剔除；
 *  未标记 → 原样返回默认卡（= 最后一次成功的回测）。标记行剔除失败不存在的情形不存在：
 *  正则命中才剔除。markerId 供日志观测（选了哪张/是否回落） */
export function applyCardSelection(
  text: string,
  registry: Record<string, AgentCard>,
  defaultCard?: AgentCard,
): { text: string; card?: AgentCard; markerId?: string } {
  const marker = /【\s*展示卡片\s*[:：]\s*(card_\d+)\s*】/.exec(text);
  if (!marker) return { text, card: defaultCard };
  const markerId = marker[1];
  return { text: text.replace(marker[0], '').trim(), card: registry[markerId] ?? defaultCard, markerId };
}

/** AIMessage.content 兼容 string / 内容块数组；正文为空时兜底退回推理模型的思考内容 */
function extractText(message: AIMessage): string {
  const content = message.content;
  const text = typeof content === 'string'
    ? content
    : content.map((p) => (typeof p === 'string' ? p : 'text' in p ? String(p.text) : '')).join('');
  if (text.trim()) return text;
  const kw = message.additional_kwargs as { reasoning_content?: unknown } | undefined;
  return typeof kw?.reasoning_content === 'string' ? kw.reasoning_content : '';
}

/** 节点日志单条内容的预览上限：超出截断并标注总字数，避免工具回执把日志刷爆 */
const LOG_PREVIEW_LIMIT = 500;

/** 进度事件里参数的预览上限（比日志更短，前端示意即可） */
const EVENT_PREVIEW_LIMIT = 120;

/** 进度事件用的短预览：复用日志预览再截到事件上限 */
function toEventPreview(value: unknown): string {
  const text = toLogPreview(value);
  return text.length > EVENT_PREVIEW_LIMIT ? `${text.slice(0, EVENT_PREVIEW_LIMIT)}…` : text;
}

/** 节点产物 → 日志字符串：字符串原样，其余 JSON 化（失败兜底 String()，日志路径不允许打断图执行） */
function toLogPreview(value: unknown): string {
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value) ?? String(value);
    } catch {
      text = String(value);
    }
  }
  return text.length > LOG_PREVIEW_LIMIT ? `${text.slice(0, LOG_PREVIEW_LIMIT)}…(共${text.length}字)` : text;
}

/** GLM 调用失败时的回复正文（唯一内容，不带卡片）：如实展示失败原因，如 429 余额不足 / 403 无模型权限 */
/** 模型侧失败 → 用户可见文案。限流（429）单独措辞——"请充值"对暂时性限流是误导 */
function llmErrorText(reason: string): string {
  if (/429|速率限制/.test(reason)) {
    return ' 智能体回复生成失败：模型服务限流，请稍后重发这条消息。';
  }
  return ` 智能体回复生成失败：智谱 GLM ${reason}。请充值或检查 ZHIPU_MODEL 配置后重试。`;
}
