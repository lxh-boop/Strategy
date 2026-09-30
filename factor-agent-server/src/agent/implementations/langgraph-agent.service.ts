import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { AgentCard, AgentReply, ChatMessage, Conversation } from '../../types';
import { ApiException } from '../../common/api.exception';
import { appendConversationLog } from '../../common/conversation-log';
import {
  ClarificationSignal,
  EqualWeightBacktestInput,
  EqualWeightBacktestService,
} from '../../core/equal-weight-backtest.service';
import { FactorDataService } from '../../core/factor-data.service';
import { FactorFieldInfo, loadTableCatalog, loadTableFieldDetails } from '../../core/factor-schema';
import { AgentService } from '../agent.service';
import { AGENT_TOOL_SPECS, ListFactorFieldsArgs, ReadFactorDataArgs } from './tool-specs';

/* ==========================================================
   智能体实现：LangGraph tool-calling，四个工具构成
   "看表 → 看因子 → 读数 / 等权回测出卡片"流程

     agent(GLM, 绑定 4 个工具) ⇄ tools(执行工具)
        │  list_factor_tables        看表清单：tables.md 目录，选出要用的表
        │  list_factor_fields        看因子清单：按表名列表查字段明细，选出要用的因子
        │  read_factor_data          读数据：按 表/因子集合/交易日/证券代码 查库
        │  run_equal_weight_backtest 等权回测：选完因子后一步回测，产出净值卡片
        ▼
     最终文案（只能引用工具返回的数据）

   - 表与字段知识全部按需加载（工具返回），prompt 不常驻任何表名字段名；
   - 白名单由服务端两道闸保证：list 工具校验表名，readTable 内部全量校验；
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
   *  last-write-wins：同一次图执行内多次回测以最后一次为准 */
  card: Annotation<AgentCard | undefined>,
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
  /** 编译后的 LangGraph 工具循环（最小结构类型，避免暴露复杂泛型） */
  private readonly app: {
    invoke(state: Partial<StrategyGraphStateType>, config?: { recursionLimit?: number }): Promise<StrategyGraphStateType>;
  } | null;

  constructor(
    config: ConfigService,
    private readonly factorData: FactorDataService,
    private readonly backtest: EqualWeightBacktestService,
  ) {
    super();
    const apiKey = config.get<string>('zhipu.apiKey') ?? '';
    const model = config.get<string>('zhipu.model') ?? 'glm-4-flash';
    const baseURL = config.get<string>('zhipu.baseUrl') ?? 'https://open.bigmodel.cn/api/paas/v4';
    const timeoutMs = Number(config.get<number>('chat.timeoutMs') ?? 20_000);
    const thinking = config.get<string>('zhipu.thinking') ?? 'disabled';

    if (apiKey.trim()) {
      this.llm = new ChatOpenAI({
        apiKey,
        modelName: model,
        temperature: 0.6,
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
      .addNode('agent', async (state: StrategyGraphStateType) => {
        const output = (await agent.invoke(state.messages)) as AIMessage;
        const calls = output.tool_calls ?? [];
        const line = calls.length
          ? `agent节点 → 工具调用 ${calls.map((c) => `${c.name}(${toLogPreview(c.args)})`).join(' ; ')}`
          : `agent节点 → 最终回复: ${toLogPreview(extractText(output))}`;
        this.logger.log(line);
        appendConversationLog(state.conversationId, line);
        return { messages: [output] };
      })
      .addNode('tools', async (state: StrategyGraphStateType) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        const additions: BaseMessage[] = [];
        let card: AgentCard | undefined;
        let backtestFreq: string | undefined;
        for (const call of last.tool_calls ?? []) {
          const runner = this.toolRunners[call.name];
          const outcome = runner
            ? await this.guard(() => runner(call.args))
            : { result: { error: `未知工具: ${call.name}` } };
          additions.push(new ToolMessage({ content: JSON.stringify(outcome.result), tool_call_id: call.id ?? '' }));
          if (outcome.card) card = outcome.card; // 回测失败时无卡片，保持上一次的值也无妨（reply 只在本次执行收尾取一次）
          if (outcome.backtestFreq) backtestFreq = outcome.backtestFreq;
          const line = `tools节点 ${call.name}(${toLogPreview(call.args)}) => ${this.toolResultPreview(call.name, outcome.result)}`;
          this.logger.log(line);
          appendConversationLog(state.conversationId, line);
        }
        return { messages: additions, ...(card ? { card } : {}), ...(backtestFreq ? { backtestFreq } : {}) };
      })
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', (state: StrategyGraphStateType) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        return last.tool_calls?.length ? 'tools' : END;
      })
      .addEdge('tools', 'agent')
      .compile();
  }

  /** 运行智能体：文本回复必给；本次执行跑成过等权回测则附带净值卡片（卡片绕过 LLM） */
  async reply(conversation: Conversation, userText: string): Promise<AgentReply> {
    // ① 未配置 Key：开发模式，纯文本提示
    if (!this.app || !this.llm) {
      return { text: '当前为开发模式（未配置智谱 Key），因子查询功能需配置 ZHIPU_API_KEY 后使用。' };
    }

    // ② tool-calling 主链路
    try {
      this.logger.log(`图执行开始 会话=${conversation.id} 提问: ${toLogPreview(userText)}`);
      appendConversationLog(conversation.id, `提问: ${toLogPreview(userText)}`);
      const state = await this.app.invoke(
        {
          conversationId: conversation.id,
          userText,
          messages: this.prepareMessages(conversation, userText),
        },
        { recursionLimit: 15 },
      );
      const last = state.messages[state.messages.length - 1] as AIMessage;
      const text = extractText(last).trim();
      if (!text) throw new LlmTextError('返回内容为空');
      return state.card ? { text, card: state.card } : { text };
    } catch (error) {
      return this.errorReply(error, conversation.id);
    }
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
  private readonly toolRunners: Record<string, (args: unknown) => Promise<ToolOutcome>> = {
    list_factor_tables: async () => ({ result: this.execListTables() }),
    list_factor_fields: async (args) => ({ result: this.execListFields(args as ListFactorFieldsArgs) }),
    read_factor_data: async (args) => ({ result: await this.execReadData(args as ReadFactorDataArgs) }),
    run_equal_weight_backtest: async (args) => this.execRunBacktest(args as EqualWeightBacktestInput),
  };

  /** 统一兜底：澄清信号 → 指引模型向用户提问；ApiException → 原因给模型自纠；其他 → 通用失败并记日志 */
  private async guard(run: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
    try {
      return await run();
    } catch (error) {
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

  /** 等权回测执行：成功 → 指标摘要给模型写文案 + 卡片经图状态绕过模型直达前端；
   *  缺 frequency 抛 ClarificationSignal、其余异常由 guard() 统一分流 */
  private async execRunBacktest(args: EqualWeightBacktestInput): Promise<ToolOutcome> {
    const output = await this.backtest.runEqualWeightBacktest(args);
    return {
      result: output.summary,
      card: output.card,
      backtestFreq: typeof args.frequency === 'string' ? args.frequency : undefined,
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

  /* ----- 消息构造 ----- */

  private prepareMessages(conversation: Conversation, userText: string): BaseMessage[] {
    const system = [
      '你是"因子智投（AlphaSage）"多因子选股智能体，面向专业投资者，基于本地因子数据库回答数据问题。',
      '工具流程：先 list_factor_tables 看有哪些表、list_factor_fields 看因子字段（表名/字段名只能来自这两个工具的返回，禁止凭记忆编造），' +
      '再按需调用 read_factor_data 查单点数据、或 run_equal_weight_backtest 做多因子等权回测——各工具的参数含义与约束以工具 schema 为准。',
      '回复规则：',
      '- 最终回复不超过 90 字，只能引用工具返回的数据，严禁编造数字或个股，不输出 JSON，结尾用短句提醒不构成投资建议；',
      '- 工具回执含"需要澄清"时，按其中"行动"指引向用户提问，不要当作错误转述；',
      '- 查询无数据行时如实告知，不要编造；',
      '- 与因子数据无关的问候或闲聊：直接简短回复（不超过 90 字），不要调用工具。',
    ].join('\n');

    const history = conversation.messages.slice(-6).map((m: ChatMessage) =>
      m.role === 'agent' ? new AIMessage({ content: m.bubble }) : new HumanMessage({ content: m.bubble }),
    );

    return [new SystemMessage({ content: system }), ...history, new HumanMessage({ content: userText })];
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
function llmErrorText(reason: string): string {
  return ` 智能体回复生成失败：智谱 GLM ${reason}。请充值或检查 ZHIPU_MODEL 配置后重试。`;
}
