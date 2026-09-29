import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { AgentReply, ChatMessage, Conversation } from '../../types';
import { ApiException } from '../../common/api.exception';
import { FactorDataService } from '../../core/factor-data.service';
import { FactorFieldInfo, loadTableCatalog, loadTableFieldDetails } from '../../core/factor-schema';
import { AgentService } from '../agent.service';

/* ==========================================================
   智能体实现：LangGraph tool-calling，三个工具构成"看表 → 看因子 → 读数"流程

     agent(GLM, 绑定 3 个工具) ⇄ tools(执行工具)
        │  list_factor_tables  看表清单：tables.md 目录，选出要用的表
        │  list_factor_fields  看因子清单：按表名列表查字段明细，选出要用的因子
        │  read_factor_data    读数据：按 表/因子集合/交易日/证券代码 查库
        ▼
     最终文案（只能引用工具返回的数据）

   - 表与字段知识全部按需加载（工具返回），prompt 不常驻任何表名字段名；
   - 白名单由服务端两道闸保证：list 工具校验表名，readTable 内部全量校验；
   - 问候/闲聊不调用工具，纯文本回复；
   - 未配置 Key：开发模式，纯文本提示；配置 Key 但 GLM 失败（429/403/超时等）：
     回复仅含失败原因（LlmTextError 语义，与前端展示约定一致）。
   ========================================================== */

/** GLM 调用失败的信号（message 即可读上游原因），由 reply() 捕获后降级为纯报错回复 */
class LlmTextError extends Error {}

/* ----- 工具定义（OpenAI function 格式；执行在图内 tools 节点） ----- */

const LIST_FACTOR_TABLES_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_factor_tables',
    description:
      '列出因子数据库中全部可用数据表（表名/中文名/说明/唯一键）。' +
      '为用户选取因子之前必须先调用本工具了解有哪些表，禁止凭记忆编造表名。',
    parameters: { type: 'object', properties: {} },
  },
};

const LIST_FACTOR_FIELDS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'list_factor_fields',
    description:
      '列出指定数据表的全部因子字段（字段名/中文名/类型/可空/说明），一次可查多张表。' +
      '表名必须来自 list_factor_tables 的返回；选出要用的因子后调用 read_factor_data 读数。',
    parameters: {
      type: 'object',
      properties: {
        tables: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '表名列表，可一次查多张表',
        },
      },
      required: ['tables'],
    },
  },
};

const READ_FACTOR_DATA_SPEC = {
  type: 'function' as const,
  function: {
    name: 'read_factor_data',
    description:
      '按 表/因子字段集合/交易日/证券代码 读取因子数据。' +
      'table 与 fields 必须来自 list_factor_tables / list_factor_fields 的返回，' +
      'date 为纯数字交易日（如 20210506），security 为证券代码（如 000002.XSHE）。',
    parameters: {
      type: 'object',
      properties: {
        table: { type: 'string', description: '数据表名' },
        fields: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '因子字段名列表',
        },
        date: { type: 'string', description: '交易日，纯数字 YYYYMMDD，如 20210506' },
        security: { type: 'string', description: '证券代码，如 000002.XSHE' },
      },
      required: ['table', 'fields', 'date', 'security'],
    },
  },
};

interface ListFactorFieldsArgs {
  tables?: unknown;
}

interface ReadFactorDataArgs {
  table?: unknown;
  fields?: unknown;
  date?: unknown;
  security?: unknown;
}

/* ----- LangGraph 状态定义 ----- */

const StrategyGraphState = Annotation.Root({
  conversationId: Annotation<string>,
  userText: Annotation<string>,
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
  ) {
    super();
    const apiKey = config.get<string>('zhipu.apiKey') ?? '';
    const model = config.get<string>('zhipu.model') ?? 'glm-4-flash';
    const baseURL = config.get<string>('zhipu.baseUrl') ?? 'https://open.bigmodel.cn/api/paas/v4';
    const timeoutMs = Number(config.get<number>('chat.timeoutMs') ?? 20_000);

    if (apiKey.trim()) {
      this.llm = new ChatOpenAI({
        apiKey,
        modelName: model,
        temperature: 0.6,
        // 推理模型（如 glm-5.3-flash）会先输出 reasoning_content 再输出正文/工具调用，
        // max_tokens 同时约束两者；工具循环里还有工具调用 JSON 开销，给足余量
        maxTokens: 2048,
        timeout: timeoutMs,
        configuration: { baseURL },
      });
      this.app = this.buildGraph(
        this.llm.bindTools([LIST_FACTOR_TABLES_SPEC, LIST_FACTOR_FIELDS_SPEC, READ_FACTOR_DATA_SPEC]) as unknown as {
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
      .addNode('agent', async (state: StrategyGraphStateType) => ({
        messages: [(await agent.invoke(state.messages)) as BaseMessage],
      }))
      .addNode('tools', async (state: StrategyGraphStateType) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        const additions: BaseMessage[] = [];
        for (const call of last.tool_calls ?? []) {
          let result: unknown;
          if (call.name === 'list_factor_tables') {
            result = this.execListTables();
          } else if (call.name === 'list_factor_fields') {
            result = this.execListFields(call.args as ListFactorFieldsArgs);
          } else if (call.name === 'read_factor_data') {
            result = await this.execReadData(call.args as ReadFactorDataArgs);
          } else {
            result = { error: `未知工具: ${call.name}` };
          }
          additions.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: call.id ?? '' }));
        }
        return { messages: additions };
      })
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', (state: StrategyGraphStateType) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        return last.tool_calls?.length ? 'tools' : END;
      })
      .addEdge('tools', 'agent')
      .compile();
  }

  /** 运行智能体，得到一条纯文本回复（因子数据问答不产卡片） */
  async reply(conversation: Conversation, userText: string): Promise<AgentReply> {
    // ① 未配置 Key：开发模式，纯文本提示
    if (!this.app || !this.llm) {
      return { text: '当前为开发模式（未配置智谱 Key），因子查询功能需配置 ZHIPU_API_KEY 后使用。' };
    }

    // ② tool-calling 主链路
    try {
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
      return { text };
    } catch (error) {
      return this.errorReply(error);
    }
  }

  /** GLM 失败 → 回复仅含失败原因（与前端展示约定一致） */
  private errorReply(error: unknown): AgentReply {
    if (error instanceof LlmTextError) {
      this.logger.warn(`GLM 调用失败: ${error.message}`);
      return { text: llmErrorText(error.message) };
    }
    const reason = this.extractUpstreamMessage(error);
    this.logger.warn(`GLM 工具链路异常: ${reason}`);
    return { text: llmErrorText(reason) };
  }

  /* ----- 工具执行（图内 tools 节点调用） ----- */

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

    try {
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
    } catch (error) {
      // ApiException（格式/白名单/连接错误）原样把 message 给模型，便于它自行纠正
      const msg = error instanceof ApiException ? error.message : '取数失败，请稍后重试';
      if (!(error instanceof ApiException)) this.logger.warn(`read_factor_data 异常: ${String(error)}`);
      return { error: msg };
    }
  }

  /* ----- 消息构造 ----- */

  private prepareMessages(conversation: Conversation, userText: string): BaseMessage[] {
    const system = [
      '你是"因子智投（AlphaSage）"多因子选股智能体，面向专业投资者，基于本地因子数据库回答因子数据问题。',
      '你有三个工具，构成"看表 → 看因子 → 读数"流程：',
      '1. list_factor_tables：列出全部可用数据表（选取因子前必须先调用）；',
      '2. list_factor_fields：按表名列表列出因子字段清单（表名必须来自工具 1 的返回）；',
      '3. read_factor_data：按 表/因子字段/交易日/证券代码 读取数据（字段名必须来自工具 2 的返回）。',
      '',
      '调用规则：',
      '- 用户问有哪些表/因子，或要查数据但你还不知道表与字段 → 先调 1/2 了解可用范围，禁止凭记忆编造表名或字段名；',
      '- 查数据必须用工具 3；拿到结果后写最终回复：不超过 90 字，只能引用工具返回的数据，严禁编造数字或个股，不输出 JSON，结尾用短句提醒不构成投资建议；',
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

/** AIMessage.content 兼容 string / 内容块数组 */
function extractText(message: AIMessage): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  return content
    .map((p) => (typeof p === 'string' ? p : 'text' in p ? String(p.text) : ''))
    .join('');
}

/** GLM 调用失败时的回复正文（唯一内容，不带卡片）：如实展示失败原因，如 429 余额不足 / 403 无模型权限 */
function llmErrorText(reason: string): string {
  return `⚠️ 智能体回复生成失败：智谱 GLM ${reason}。请充值或检查 ZHIPU_MODEL 配置后重试。`;
}
