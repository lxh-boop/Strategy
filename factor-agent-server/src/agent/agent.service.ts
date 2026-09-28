import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { AgentCard, AgentReply, ChatMessage, Conversation, MetricItem, ReportCard } from '../types';
import { BacktestService, mkBench, normalizeWeights, toMetricItems } from '../core/backtest.service';
import { ScreenService } from '../core/screen.service';
import { StoreService } from '../core/store.service';
import { CURVE_S2, LastReport } from '../core/store.service';
import { loadFactorKnowledge } from './factor-knowledge';

/* ==========================================================
   智能体：LangGraph tool-calling，两个工具构成"选因子 → 回测"流程

     agent(GLM, 绑定 2 个工具) ⇄ tools(执行工具)
        │  select_factors  选因子：抽取因子/权重/股票池/调仓/命名，记录策略配置
        │  run_backtest    回测：对当前配置执行回测，产出报告卡片
        ▼
     最终文案（只能引用工具返回的数据）

   - 会话内记忆 lastReport 充当"当前策略配置"：支持"再回测一下它"、
     "把低波动提到 40"这类多轮追问与修改；
   - 选股筛选（筛选/ROE/估值/白酒）仍走规则分支，产出 stocks 卡片（演示功能）；
   - 问候/闲聊不调用工具，纯文本回复；
   - 未配置 Key：开发模式，走关键词规则 + 模板文案；
   - 配置了 Key 但 GLM 失败（429 余额不足 / 403 无权限 / 超时等）：
     回复仅含失败原因，不带卡片（LlmTextError 语义，与前端展示约定一致）。
   ========================================================== */

interface StrategyStyle {
  keys: string[];
  name: string;
  tag: string;
  universe: string;
  rebalance: string;
  benchName: string;
  factors: [string, number][];
}

const STRATEGY_STYLES: StrategyStyle[] = [
  {
    keys: ['小盘', '动量'], name: '小盘动量增强', tag: '进攻型',
    universe: '中证1000', rebalance: '每周调仓', benchName: '中证1000指数',
    factors: [['动量', 45], ['小市值', 25], ['流动性', 20], ['情绪', 10]],
  },
  {
    keys: ['低波', '红利', '股息', '防御'], name: '稳健红利低波', tag: '防御型',
    universe: '沪深300 + 中证500', rebalance: '每月调仓', benchName: '中证红利指数',
    factors: [['股息率', 35], ['低波动', 30], ['质量', 20], ['价值', 15]],
  },
  {
    keys: ['成长', '质量'], name: '成长质量双驱动', tag: '均衡型',
    universe: '中证800', rebalance: '每两周调仓', benchName: '中证800成长',
    factors: [['成长', 40], ['质量', 35], ['动量', 25]],
  },
  {
    keys: ['价值', '低估'], name: '基本面价值精选', tag: '防御型',
    universe: '全市场（剔除ST）', rebalance: '每季度调仓', benchName: '沪深300指数',
    factors: [['价值', 50], ['质量', 30], ['股息率', 20]],
  },
];

const DEFAULT_STYLE: StrategyStyle = {
  keys: [], name: '多因子均衡组合', tag: '均衡型',
  universe: '沪深300 + 中证500', rebalance: '每月调仓', benchName: '沪深300指数',
  factors: [['价值', 30], ['质量', 30], ['动量', 25], ['低波动', 15]],
};

/** 策略构建类关键词：仅用于"无 Key 开发模式"的规则兜底 */
const REPORT_KEYWORDS = [
  '策略', '组合', '构建', '配置', '调仓', '仓位', '持仓', '轮动', '增强', '因子', '选股', '权重',
  '小盘', '动量', '低波', '红利', '股息', '防御', '成长', '质量', '价值', '低估',
];

/** 选股筛选意图（规则分支，非工具）：产出 stocks 卡片 */
const STOCKS_KEYWORDS = ['筛选', 'ROE', 'roe', '估值', '白酒'];

function isStocksIntent(text: string): boolean {
  return STOCKS_KEYWORDS.some((k) => text.includes(k));
}

function pickStyle(text: string): StrategyStyle {
  return STRATEGY_STYLES.find((s) => s.keys.some((k) => text.includes(k))) ?? DEFAULT_STYLE;
}

/** 股票池 → 默认业绩基准 */
const UNIVERSE_BENCH: [string, string][] = [
  ['中证1000', '中证1000指数'],
  ['中证800', '中证800成长'],
  ['沪深300', '沪深300指数'],
];

function benchOf(universe: string): string {
  const hit = UNIVERSE_BENCH.find(([key]) => universe.includes(key));
  return hit ? hit[1] : '沪深300指数';
}

/** GLM 调用失败的信号（message 即可读上游原因），由 reply() 捕获后降级为纯报错回复 */
class LlmTextError extends Error {}

/* ----- 工具定义（OpenAI function 格式；执行在图内 tools 节点，便于拿到会话上下文） ----- */

const SELECT_FACTORS_SPEC = {
  type: 'function' as const,
  function: {
    name: 'select_factors',
    description:
      '选因子：从用户描述中抽取因子与权重，记录策略配置（"选因子→回测"流程的第一步）。' +
      '用户构建或调整策略时调用；调整时（如"低波动提到40"）基于当前配置修改后整体传入。',
    parameters: {
      type: 'object',
      properties: {
        factors: {
          type: 'array',
          minItems: 1,
          description: '因子与权重列表，权重合计可以不为 100（后端自动归一化）',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: '因子短名：价值/成长/动量/质量/低波动/股息率/流动性/小市值/情绪' },
              weight: { type: 'number', description: '权重，正数' },
            },
            required: ['name', 'weight'],
          },
        },
        universe: { type: 'string', description: '股票池，如 沪深300 / 中证800 / 中证1000；默认 沪深300 + 中证500' },
        rebalance: { type: 'string', description: '调仓频率，如 每周调仓 / 每月调仓；默认 每月调仓' },
        name: { type: 'string', description: '策略名称，如 稳健红利低波' },
        tag: { type: 'string', enum: ['进攻型', '均衡型', '防御型'], description: '风格标签' },
      },
      required: ['factors'],
    },
  },
};

const RUN_BACKTEST_SPEC = {
  type: 'function' as const,
  function: {
    name: 'run_backtest',
    description:
      '回测：对当前已记录的因子配置执行回测并生成策略报告（第二步，需先 select_factors）。' +
      '"再回测一下 / 看看它的表现"等请求直接调用本工具。',
    parameters: { type: 'object', properties: {} },
  },
};

interface SelectFactorsArgs {
  factors: { name: string; weight: number }[];
  universe?: string;
  rebalance?: string;
  name?: string;
  tag?: string;
}

/* ----- LangGraph 状态定义 ----- */

const StrategyGraphState = Annotation.Root({
  conversationId: Annotation<string>,
  userText: Annotation<string>,
  messages: Annotation<BaseMessage[]>({
    reducer: (a, b) => a.concat(b),
    default: () => [],
  }),
  card: Annotation<AgentCard | null>({ reducer: (_, b) => b, default: () => null }),
});

type StrategyGraphStateType = typeof StrategyGraphState.State;

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  /** 智谱 GLM（OpenAI 兼容协议）；未配置 Key 时为 null，走规则兜底（开发模式） */
  private readonly llm: ChatOpenAI | null;
  /** 编译后的 LangGraph 工具循环（最小结构类型，避免暴露复杂泛型） */
  private readonly app: {
    invoke(state: Partial<StrategyGraphStateType>, config?: { recursionLimit?: number }): Promise<StrategyGraphStateType>;
  } | null;

  constructor(
    config: ConfigService,
    private readonly backtest: BacktestService,
    private readonly screen: ScreenService,
    private readonly store: StoreService,
  ) {
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
        this.llm.bindTools([SELECT_FACTORS_SPEC, RUN_BACKTEST_SPEC]) as unknown as {
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
        let card: AgentCard | null = null;
        for (const call of last.tool_calls ?? []) {
          let result: unknown;
          if (call.name === 'select_factors') {
            result = this.execSelectFactors(state.conversationId, state.userText, call.args as SelectFactorsArgs);
          } else if (call.name === 'run_backtest') {
            const r = this.execRunBacktest(state.conversationId);
            result = r.summary;
            card = r.card;
          } else {
            result = { error: `未知工具: ${call.name}` };
          }
          additions.push(new ToolMessage({ content: JSON.stringify(result), tool_call_id: call.id ?? '' }));
        }
        // 只在有新卡片时覆盖 state.card，避免 select_factors 等其他工具执行把它清掉
        return { messages: additions, ...(card ? { card } : {}) };
      })
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', (state: StrategyGraphStateType) => {
        const last = state.messages[state.messages.length - 1] as AIMessage;
        return last.tool_calls?.length ? 'tools' : END;
      })
      .addEdge('tools', 'agent')
      .compile();
  }

  /** 运行智能体，得到一条完整回复（文案 + 可选卡片） */
  async reply(conversation: Conversation, userText: string, routeText: string): Promise<AgentReply> {
    // ① 选股筛选：规则意图分支（演示功能，非工具）
    if (isStocksIntent(userText)) {
      try {
        const card = this.buildStocksCard();
        return { text: await this.composePlain(conversation, userText, card), card };
      } catch (error) {
        return this.errorReply(error);
      }
    }

    // ② 未配置 Key：开发模式，关键词规则 + 模板文案
    if (!this.app || !this.llm) {
      return this.legacyReply(conversation, userText, routeText);
    }

    // ③ tool-calling 主链路
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
      if (!text && !state.card) throw new LlmTextError('返回内容为空');
      return { text: text || fallbackText(state.card), card: state.card ?? undefined };
    } catch (error) {
      return this.errorReply(error);
    }
  }

  /** GLM 失败 → 回复仅含失败原因，不带卡片（与前端展示约定一致） */
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

  private execSelectFactors(conversationId: string, userText: string, args: SelectFactorsArgs): Record<string, unknown> {
    const factors = Array.isArray(args.factors) ? args.factors : [];
    if (!factors.length || factors.some((f) => !f?.name || !Number.isFinite(Number(f.weight)))) {
      return { error: 'factors 参数不合法：需要至少一个 {name, weight}，weight 为数字' };
    }
    const normalized = normalizeWeights(factors.map((f) => ({ name: String(f.name), weight: Number(f.weight) })));
    if (normalized.every((f) => f.weight === 0)) {
      return { error: '因子权重合计为 0，请至少给出一个正权重因子' };
    }

    const preset = pickStyle(userText);
    const universe = args.universe?.trim() || preset.universe;
    const config: LastReport = {
      name: args.name?.trim() || preset.name,
      tag: args.tag?.trim() || preset.tag,
      factors: normalized,
      universe,
      rebalance: args.rebalance?.trim() || preset.rebalance,
      benchName: benchOf(universe),
    };
    this.store.setLastReport(conversationId, config);

    return {
      ok: true,
      已记录配置: {
        策略名: config.name,
        风格: config.tag,
        因子权重: config.factors,
        股票池: config.universe,
        调仓: config.rebalance,
        基准: config.benchName,
      },
      提示: '配置已保存，请继续调用 run_backtest 生成回测报告',
    };
  }

  private execRunBacktest(conversationId: string): { summary: Record<string, unknown>; card: ReportCard | null } {
    const config = this.store.getLastReport(conversationId);
    if (!config) {
      return { summary: { error: '当前会话还没有因子配置，请先调用 select_factors' }, card: null };
    }

    // 种子只取配置本身：同一份配置永远同一份报告（确定性引擎）
    const bt = this.backtest.runBacktest({
      seedKey: `${conversationId}|${config.universe}|${config.rebalance}|${JSON.stringify(config.factors)}`,
      factors: config.factors,
      universe: config.universe,
      rebalance: config.rebalance,
    });

    const card: ReportCard = {
      type: 'report',
      title: `${config.name} · 回测报告`,
      tag: config.tag,
      factors: config.factors,
      curve: bt.curve,
      benchCurve: bt.benchCurve,
      benchName: config.benchName,
      metrics: toMetricItems(bt.metrics),
      rawMetrics: bt.metrics,
      universe: config.universe,
      rebalance: config.rebalance,
      note: `股票池与调仓：${config.universe}，${config.rebalance}，单票权重上限 8%。可保存后在策略详情中继续调整权重，保存时会按新配置自动重新回测。`,
    };

    return {
      summary: {
        ok: true,
        报告: {
          策略名: config.name,
          风格: config.tag,
          因子权重: config.factors,
          股票池: config.universe,
          调仓: config.rebalance,
          基准: config.benchName,
          绩效指标: card.metrics,
        },
        提示: '回测完成，请据此用不超过 90 字写最终回复，不要再调用工具',
      },
      card,
    };
  }

  /* ----- 消息构造 ----- */

  private prepareMessages(conversation: Conversation, userText: string): BaseMessage[] {
    const last = this.store.getLastReport(conversation.id);
    const system = [
      '你是"因子智投（AlphaSage）"多因子选股智能体，面向专业投资者。',
      '你有两个工具，构成"选因子 → 回测"流程：',
      '1. select_factors：抽取用户描述中的因子与权重（可含股票池/调仓频率/策略名/风格标签），记录策略配置；',
      '2. run_backtest：对当前已记录的配置执行回测，返回绩效报告。',
      '',
      '===== 因子知识库（select_factors 传参必须以下文"短名"为准） =====',
      loadFactorKnowledge(),
      '===== 调用规则 =====',
      '- 用户想构建策略 → 先调 select_factors，拿到确认后再调 run_backtest；',
      '- 调整类请求（如"低波动提到40"）→ 基于当前配置整体修改后重新 select_factors，再 run_backtest；',
      '- "它 / 这个策略"指当前会话最近配置：' + (last ? JSON.stringify(last) : '尚无（用户未选因子就要回测时，先按其描述 select_factors）'),
      '- 拿到 run_backtest 结果后写最终回复：不超过 90 字，只能引用工具返回的数据，严禁编造数字或个股，不输出 JSON，结尾用短句提醒不构成投资建议；',
      '- 与选股策略无关的问候或闲聊：直接简短回复（不超过 90 字），不要调用工具。',
    ].join('\n');

    const history = conversation.messages.slice(-6).map((m: ChatMessage) =>
      m.role === 'agent' ? new AIMessage({ content: m.bubble }) : new HumanMessage({ content: m.bubble }),
    );

    return [new SystemMessage({ content: system }), ...history, new HumanMessage({ content: userText })];
  }

  /* ----- 选股筛选分支（规则卡片 + GLM/模板文案） ----- */

  private buildStocksCard(): AgentCard {
    // 演示条件：ROE(TTM) > 15 且 PE 历史分位 < 30
    const result = this.screen.screen({
      universe: '沪深300',
      filters: [
        { field: 'roe_ttm', op: '>', value: 15 },
        { field: 'pe_percentile', op: '<', value: 30 },
      ],
      topN: 5,
    });

    return {
      type: 'stocks',
      title: '沪深300 · 高ROE低估值筛选结果',
      tag: `共 ${result.total} 只 · 展示前 ${result.stocks.length}`,
      stocks: result.stocks,
      note: '该筛选未考虑行业集中度，如需控制行业暴露可以让我加入行业中性化约束。',
    };
  }

  /** 普通文案生成（无工具，用于 stocks 分支）；GLM 失败抛 LlmTextError */
  private async composePlain(conversation: Conversation, userText: string, card: AgentCard): Promise<string> {
    // 未配置 Key 是文档化的开发模式（README：不填也能跑），保留模板文案
    if (!this.llm) return fallbackText(card);

    try {
      const system = [
        '你是"因子智投（AlphaSage）"多因子选股智能体。',
        '系统刚为用户生成了下方 JSON 的选股筛选结果，请为这条回复撰写正文：直接输出正文，不要 JSON/标题/列表，不超过 90 字，只能引用给定数据，结尾提醒不构成投资建议。',
        JSON.stringify({ title: card.title, tag: card.tag, stocks: card.type === 'stocks' ? card.stocks : [], note: card.note }),
      ].join('\n');
      const res = await this.llm.invoke([
        new SystemMessage({ content: system }),
        ...conversation.messages.slice(-6).map((m) =>
          m.role === 'agent' ? new AIMessage({ content: m.bubble }) : new HumanMessage({ content: m.bubble }),
        ),
        new HumanMessage({ content: userText }),
      ]);
      const text = extractText(res).trim();
      if (!text) throw new LlmTextError('返回内容为空');
      return text;
    } catch (error) {
      if (error instanceof LlmTextError) throw error;
      throw new LlmTextError(this.extractUpstreamMessage(error));
    }
  }

  /* ----- 无 Key 开发模式兜底：关键词规则路径 ----- */

  private legacyReply(conversation: Conversation, userText: string, routeText: string): AgentReply {
    const contextHit = ['回测', '表现', '历史'].some((k) => routeText.includes(k));
    const currentReport = REPORT_KEYWORDS.some((k) => userText.includes(k));

    if (contextHit && !currentReport) {
      const card = this.legacyBacktestCard(conversation.id, conversation.messages.length, routeText);
      return { text: fallbackText(card), card };
    }
    if (currentReport) {
      const card = this.legacyReportCard(conversation.id, conversation.messages.length, userText, routeText);
      return { text: fallbackText(card), card };
    }
    return { text: CHAT_FALLBACK_TEXT };
  }

  private legacyReportCard(conversationId: string, historyLen: number, userText: string, routeText: string): ReportCard {
    const style = pickStyle(userText) !== DEFAULT_STYLE ? pickStyle(userText) : pickStyle(routeText);
    const factors = style.factors.map(([name, weight]) => ({ name, weight }));
    const bt = this.backtest.runBacktest({
      seedKey: `${conversationId}|${routeText}|${historyLen}`,
      factors,
      universe: style.universe,
      rebalance: style.rebalance,
    });

    this.store.setLastReport(conversationId, {
      name: style.name,
      tag: style.tag,
      factors,
      universe: style.universe,
      rebalance: style.rebalance,
      benchName: style.benchName,
    });

    return {
      type: 'report',
      title: `${style.name} · 回测报告`,
      tag: style.tag,
      factors,
      curve: bt.curve,
      benchCurve: bt.benchCurve,
      benchName: style.benchName,
      metrics: toMetricItems(bt.metrics),
      rawMetrics: bt.metrics,
      universe: style.universe,
      rebalance: style.rebalance,
      note: `股票池与调仓：${style.universe}，${style.rebalance}，单票权重上限 8%。可保存后在策略详情中继续调整权重，保存时会按新配置自动重新回测。`,
    };
  }

  private legacyBacktestCard(conversationId: string, historyLen: number, routeText: string): AgentCard {
    const last = this.store.getLastReport(conversationId);
    if (last) {
      const bt = this.backtest.runBacktest({
        seedKey: `${conversationId}|bt|${historyLen}|${routeText}`,
        factors: last.factors,
        universe: last.universe,
        rebalance: last.rebalance,
      });
      const metrics: MetricItem[] = toMetricItems(bt.metrics);
      return {
        type: 'backtest',
        title: `${last.name} · 回测报告`,
        tag: '近三年',
        curve: bt.curve,
        benchCurve: bt.benchCurve,
        benchName: last.benchName,
        metrics,
        note: `回测区间 2023-09 ~ 2026-09（月频 30 期），Top K 50，双边手续费 0.1%；相对基准 ${last.benchName} 的超额收益已扣除交易成本。`,
      };
    }

    return {
      type: 'backtest',
      title: '动量因子组合 · 回测报告',
      tag: '近三年',
      curve: CURVE_S2,
      benchCurve: mkBench(CURVE_S2),
      benchName: '中证800成长',
      metrics: [
        { label: '年化收益', value: '+21.3%', cls: 'up' },
        { label: '最大回撤', value: '-14.7%', cls: 'down' },
        { label: '夏普比率', value: '1.38' },
        { label: '胜率', value: '58.2%' },
      ],
      note: '回测期内组合跑赢中证800成长基准 9.6 个百分点，信息比率 1.12；回撤主要出现在 2024 年 1 月的小盘流动性冲击阶段。',
    };
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

/** 普通对话的兜底文案（未配置 Key 的开发模式） */
const CHAT_FALLBACK_TEXT =
  '你好！我是多因子选股智能体：可以帮你构建多因子策略、回测历史表现、按条件筛选个股。' +
  '试着描述你的需求，例如「构建一个低波动 + 高股息的防御策略」。';

/** 兜底文案（与前端演示文案一致） */
function fallbackText(card: AgentCard | null): string {
  if (!card) return '好的，已处理你的请求。';
  if (card.type === 'report') {
    return `好的，已按你的描述构建「${card.title.replace(' · 回测报告', '')}」策略：因子配置如下，回测报告也一并生成好了（收益已扣除手续费）。`;
  }
  if (card.type === 'backtest') {
    return '已对你选中的因子组合完成近三年回测（2023-09 至 2026-09），关键绩效指标如下：';
  }
  return '筛选完成。我在沪深300成分股中按「ROE(TTM) > 15% 且 PE 历史分位 < 30%」进行交叉筛选，并对结果按综合因子得分排序：';
}
