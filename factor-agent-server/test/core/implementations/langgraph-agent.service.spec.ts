import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { Annotation, Command, END, MemorySaver, START, StateGraph } from '@langchain/langgraph';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Conversation } from '../../../src/types';
import {
  bubbleChars,
  estimateTokens,
  formatTableCatalog,
  isGlmRateLimitError,
  LangGraphAgentService,
  planHistoryWindow,
  projectMessagesForModel,
  splitChatTurns,
  stripTableCatalog,
  summarizeToolReceipt,
  extractBestCardMarker,
} from '../../../src/agent/implementations/langgraph-agent.service';
import { FactorDataService } from '../../../src/core/factor-data.service';
import { MemoryUserStoreService } from '../../../src/core/implementations/memory-user-store.service';
import { MemoryEntry } from '../../../src/core/memory-store.service';
import { MemoryFileStoreService } from '../../../src/core/implementations/memory-file-store.service';
import { FactorAnalysisService } from '../../../src/core/factor-analysis.service';
import { StrategyBacktestService } from '../../../src/core/strategy-backtest.service';

/* ==========================================================
   智能体 system prompt 拼装单元测试：表目录注入 + 数据会话门 + 长期记忆注入
   - 无 Key 构造（开发模式，不建 LLM），只测 prompt 组装逻辑；
   - 目录读仓库内真实 SQL/tables.md（与 factor-schema.spec 同口径）；
   - 门语义：未执行过因子工具的会话不带目录（探索指令），
     dataConversations 中的会话带目录原文、免探索直达字段/读数/回测；
   - 记忆段（ADR-0007）：带 userId 的会话注入条目，空记忆/无 userId 不注入。
   ========================================================== */

/** 临时记忆根目录：整个 spec 文件共享一个，afterAll 清理 */
const MEMORY_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-spec-mem-'));

/** 无 Key 配置：get 恒 undefined → 开发模式分支，不创建 LLM 与图 */
function newService(): LangGraphAgentService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new LangGraphAgentService(
    config,
    {} as FactorDataService,
    {} as StrategyBacktestService,
    {} as FactorAnalysisService,
    new MemoryUserStoreService(),
    new MemoryFileStoreService(MEMORY_ROOT),
  );
}

function conv(id: string): Conversation {
  return { id, title: '', messages: [], updatedAt: 0 };
}

/** 私有成员的两个类型安全访问口径 */
type PromptBuilder = { prepareMessages(c: Conversation, text: string): Promise<BaseMessage[]> };
type Gate = { dataConversations: Set<string> };

async function systemOf(service: LangGraphAgentService, id: string): Promise<string> {
  const builder = service as unknown as PromptBuilder;
  const messages = await builder.prepareMessages(conv(id), '你好');
  const last = messages[messages.length - 1];
  expect(last).toBeInstanceOf(HumanMessage);
  expect((last as HumanMessage).content).toBe('你好');
  expect(messages[0]).toBeInstanceOf(SystemMessage);
  return String((messages[0] as SystemMessage).content);
}

describe('LangGraphAgentService（表目录注入 + 数据会话门）', () => {
  afterAll(() => {
    fs.rmSync(MEMORY_ROOT, { recursive: true, force: true });
  });

  it('未执行过因子工具的会话：system 走探索指令，不注入目录块', async () => {
    const service = newService();
    const system = await systemOf(service, 'conv-fresh');
    expect(system).toContain('先 list_factor_tables 看有哪些表');
    expect(system).toContain('list_factor_fields 看因子字段');
    expect(system).not.toContain('【数据表目录】');
    expect(system).not.toContain('直接从中选定数据表');
  });

  it('进门的会话（执行过任一因子工具）：system 注入目录原文，指令改为直接选表', async () => {
    const service = newService();
    (service as unknown as Gate).dataConversations.add('conv-data');
    const system = await systemOf(service, 'conv-data');
    expect(system).toContain('【数据表目录】');
    expect(system).toContain('与 list_factor_tables 返回一致，无需再调用该工具');
    // 目录内容为真实字典原文（照录不压缩），以 mkt_idxd 为样本断言
    expect(system).toContain('- mkt_idxd（指数日行情）：');
    expect(system).toContain('指数的日度收盘信息');
    expect(system).toContain('唯一键: INDEX_ID,TRADE_DATE');
    // 指令切换：不再要求先看表
    expect(system).toContain('直接从中选定数据表');
    expect(system).not.toContain('先 list_factor_tables');
  });

  it('formatTableCatalog：每表一行原文照录，唯一键缺省时不追加', () => {
    const block = formatTableCatalog([
      { table: 't_a', title: '表甲', description: '描述甲。', uniqueKey: 'ID,DATE' },
      { table: 't_b', title: '表乙', description: '描述乙', uniqueKey: '' },
    ]);
    const lines = block.split('\n');
    expect(lines[0]).toContain('【数据表目录】');
    expect(lines[1]).toBe('- t_a（表甲）：描述甲。 唯一键: ID,DATE');
    expect(lines[2]).toBe('- t_b（表乙）：描述乙');
  });
});

describe('LangGraphAgentService（长期记忆注入，ADR-0013 记忆队列）', () => {
  const userId = 42;
  type PromptBuilder = { prepareMessages(c: Conversation, text: string): Promise<BaseMessage[]> };

  async function systemWithQueue(
    seed: { title: string; content: string }[],
    opts?: { summary?: string },
    uid: number = userId,
  ): Promise<string> {
    const store = new MemoryFileStoreService(MEMORY_ROOT);
    const entries: MemoryEntry[] = [];
    if (opts?.summary) {
      // 折叠摘要 = 队首条目（【记忆摘要】前缀，content 为三段要点）
      entries.push({ time: '2026-10-28 08:00', title: '【记忆摘要】更早记忆的浓缩', content: opts.summary });
    }
    for (const item of seed) entries.push({ time: '2026-10-29 09:00', title: item.title, content: item.content });
    await store.writeQueue(uid, entries);
    const service = newService();
    const messages = await (service as unknown as PromptBuilder).prepareMessages(
      { ...conv('conv-mem'), userId: uid },
      '你好',
    );
    return String((messages[0] as SystemMessage).content);
  }

  it('有条目且带 userId：system 注入记忆块（摘要条目 + 条目行按时间序）', async () => {
    const system = await systemWithQueue([{ title: '偏好动量', content: '只做 20 日动量。' }], {
      summary: '更早记忆的浓缩要点',
    });
    expect(system).toContain('【用户长期记忆】');
    expect(system).toContain('【记忆摘要】更早记忆的浓缩');
    expect(system).toContain('- [');
    expect(system).toContain('偏好动量：只做 20 日动量。');
  });

  it('记忆为空：不注入记忆块（prompt 与既往一致）', async () => {
    const system = await systemWithQueue([], undefined, 43); // 全新用户：无任何记忆
    expect(system).not.toContain('【用户长期记忆】');
  });

  it('会话不带 userId（编排层漏接线的防御口径）：不注入记忆块', async () => {
    const store = new MemoryFileStoreService(MEMORY_ROOT);
    await store.appendEntry(userId, { title: '孤儿条目', content: '不应出现。' });
    const service = newService();
    const messages = await (service as unknown as PromptBuilder).prepareMessages(conv('conv-nouser'), '你好');
    expect(String((messages[0] as SystemMessage).content)).not.toContain('【用户长期记忆】');
  });

  it('开发模式（无 LLM）超预算也不折叠：宁多勿失，全量注入', async () => {
    await systemWithQueue([{ title: '巨长记忆', content: '长'.repeat(4000) }]);
    const service = newService(); // 无 LLM
    const messages = await (service as unknown as PromptBuilder).prepareMessages(
      { ...conv('conv-mem-nofold'), userId },
      '你好',
    );
    expect(String((messages[0] as SystemMessage).content)).toContain('长'.repeat(4000));
  });
});

describe('历史滚动窗口（prompt 分支，ADR-0007 修订）', () => {
  const msg = (role: 'user' | 'agent', text: string) =>
    ({ role, bubble: text, time: '10:00' }) as Conversation['messages'][number];
  type PromptBuilder = { prepareMessages(c: Conversation, text: string): Promise<BaseMessage[]> };

  it('splitChatTurns：用户开轮、助手归轮；开头无用户时助手自成一轮', () => {
    const turns = splitChatTurns([msg('user', 'q1'), msg('agent', 'a1'), msg('user', 'q2'), msg('agent', 'a2')]);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
    expect(turns[1].text).toBe('用户：q2' + '\n' + '助手：a2');
    const weird = splitChatTurns([msg('agent', 'hi'), msg('user', 'q')]);
    expect(weird).toHaveLength(2);
    expect(weird[0].startIndex).toBe(0);
  });

  it('estimateTokens：中文≈1/字、ASCII≈1/4', () => {
    expect(estimateTokens('回测策略')).toBe(4);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('回测abcd')).toBe(3);
  });

  it('planHistoryWindow：未超预算全量保留；超预算保最近 2 轮、边界收整条轮', () => {
    const msgs = [
      msg('user', '一'.repeat(600)), msg('agent', '二'.repeat(600)),
      msg('user', '三'.repeat(600)), msg('agent', '四'.repeat(600)),
      msg('user', '五'.repeat(600)), msg('agent', '六'.repeat(600)),
    ];
    const ok = planHistoryWindow(msgs, { maxTokens: 10_000, keepTurns: 2 });
    expect(ok).toMatchObject({ overflow: false, boundaryChars: 0 });
    expect(ok.kept).toHaveLength(6);
    const plan = planHistoryWindow(msgs, { maxTokens: 3000, keepTurns: 2 });
    expect(plan.overflow).toBe(true);
    expect(plan.kept).toHaveLength(4);
    expect(plan.boundaryChars).toBe(bubbleChars(msgs.slice(0, 2)));
  });

  it('planHistoryWindow：单轮巨长击穿预算 → 如实保留不折叠', () => {
    const msgs = [msg('user', '长'.repeat(5000))];
    const plan = planHistoryWindow(msgs, { maxTokens: 100, keepTurns: 2 });
    expect(plan).toMatchObject({ overflow: false, boundaryChars: 0 });
    expect(plan.kept).toHaveLength(1);
  });

  it('短会话全量原文注入（无摘要轮）', async () => {
    const service = newService();
    const conv: Conversation = {
      id: 'conv-window-short',
      title: '',
      updatedAt: 0,
      userId: 20,
      messages: Array.from({ length: 6 }, (_, i) => msg(i % 2 ? 'agent' : 'user', `第${i}轮`)),
    };
    const messages = await (service as unknown as PromptBuilder).prepareMessages(conv, '新问题');
    expect(messages).toHaveLength(8); // system + 6 原文 + 当前问题
    expect(messages.map((m) => String(m.content))).toContain('第0轮');
    expect(messages.map((m) => String(m.content))).toContain('第5轮');
  });

  it('超预算：注入 = system + 摘要轮(一问一答) + 最近 2 轮原文 + 新问题；折叠落盘且幂等', async () => {
    const userId = 30;
    const SUMMARY = '一、需求与结论：调优动量策略。二、已确定的关键参数：20 日动量。三、未决事项：无。';
    const service = newService();
    const invoke = jest.fn().mockResolvedValue({ content: SUMMARY, additional_kwargs: {} });
    (service as unknown as { llm: unknown }).llm = { invoke };
    Object.assign(service as unknown as Record<string, number>, { historyMaxTokens: 80, historyKeepTurns: 2 });
    const conv: Conversation = {
      id: 'conv-window-fold',
      title: '',
      updatedAt: 0,
      userId,
      messages: Array.from({ length: 6 }, (_, i) => msg(i % 2 ? 'agent' : 'user', '长'.repeat(60))),
    };
    const messages = await (service as unknown as PromptBuilder).prepareMessages(conv, '新问题');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(8); // system + 摘要问/答 + 2 轮原文(4) + 新问题
    expect(String(messages[1].content)).toContain('【历史归档】');
    expect(String(messages[2].content)).toContain('好的，此前对话要点如下');
    expect(String(messages[2].content)).toContain(SUMMARY);
    expect(String(messages[3].content)).toBe('长'.repeat(60));
    expect(String(messages[6].content)).toBe('长'.repeat(60));
    const store = new MemoryFileStoreService(MEMORY_ROOT);
    const summary = await store.readSummary(userId, 'conv-window-fold');
    expect(summary).not.toBeNull();
    expect(summary!.coveredChars).toBe(bubbleChars(conv.messages.slice(0, 2)));
    // 再组装一次：摘要已覆盖边界，LLM 零新调用（折叠幂等）
    await (service as unknown as PromptBuilder).prepareMessages(conv, '再来一问');
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('save_memory（长期记忆写入闭环，ADR-0013 记忆队列）', () => {
  const conv = (id: string): Conversation => ({ id, title: '', messages: [], updatedAt: 0 });
  type SaveRunner = {
    execSaveMemory(
      args: unknown,
      ctx: { delegated: boolean; conversationId: string; userId?: number },
    ): Promise<{ result: Record<string, unknown> }>;
  };
  const ctxOf = (userId?: number) => ({ delegated: false, conversationId: 'spec-save', userId });
  const add = (title: string, extra: Record<string, unknown> = {}) => ({ op: 'add', title, content: '内容。', ...extra });

  it('add：落盘成功，回执带「已记住」与时间戳', async () => {
    const service = newService();
    const r = await (service as unknown as SaveRunner).execSaveMemory(add('偏好动量'), ctxOf(9));
    expect(r.result).toMatchObject({ ok: true, 回执: '已记住：偏好动量' });
    const q = await new MemoryFileStoreService(MEMORY_ROOT).readQueue(9);
    expect(q.map((e) => e.title)).toContain('偏好动量');
    expect(q[0].time).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  });

  it('重复确认同一主题：直接追加不判重（两条并存，追加即保鲜）', async () => {
    const service = newService();
    await (service as unknown as SaveRunner).execSaveMemory(add('偏好动量'), ctxOf(10));
    await (service as unknown as SaveRunner).execSaveMemory(add('偏好动量'), ctxOf(10));
    const q = await new MemoryFileStoreService(MEMORY_ROOT).readQueue(10);
    expect(q.filter((e) => e.title === '偏好动量')).toHaveLength(2);
  });

  it('update 已并入 add：修正偏好=追加修正版', async () => {
    const service = newService();
    const r = await (service as unknown as SaveRunner).execSaveMemory(
      { op: 'update', title: '偏好动量', content: '改用低波动。' },
      ctxOf(11),
    );
    expect(r.result).toMatchObject({ ok: true, 回执: '已记住：偏好动量' });
    const q = await new MemoryFileStoreService(MEMORY_ROOT).readQueue(11);
    expect(q).toHaveLength(1);
    expect(q[0].content).toBe('改用低波动。');
  });

  it('缺 content：逐项报错不落盘', async () => {
    const service = newService();
    const runner = service as unknown as SaveRunner;
    expect(String((await runner.execSaveMemory({ op: 'add', title: '只有标题' }, ctxOf(13))).result.error)).toContain('参数不完整');
    await expect(new MemoryFileStoreService(MEMORY_ROOT).readQueue(13)).resolves.toEqual([]);
  });

  it('会话未携带 userId（防御口径）：报错不落盘', async () => {
    const service = newService();
    const r = await (service as unknown as SaveRunner).execSaveMemory(add('no-user'), ctxOf(undefined));
    expect(String(r.result.error)).toContain('未携带用户身份');
  });

  it('图闭环：save_memory 工具调用经 tools 节点落盘，ToolMessage 回执带「已记住」', async () => {
    const { app, agent } = buildTestGraph();
    agent.invoke
      .mockImplementationOnce(async () =>
        withToolCalls('save_memory', '', [{ id: 'm1', args: { op: 'add', title: '图测条目', content: '图级闭环写入。' } }]),
      )
      .mockImplementationOnce(async () => finalText('已记住你的偏好。'));
    const state = (await app.invoke(
      { conversationId: 'spec-mem-graph', userText: '记住我只做动量', userId: 14, messages: [new HumanMessage('记住我只做动量')] },
      { configurable: { thread_id: 'mem-graph-1' }, recursionLimit: 25 },
    )) as { messages: BaseMessage[] };
    const toolMsg = state.messages.find((m) => (m as unknown as { tool_call_id?: string }).tool_call_id === 'm1');
    expect(toolMsg).toBeInstanceOf(ToolMessage);
    expect(JSON.parse(String((toolMsg as ToolMessage).content))).toMatchObject({ 回执: '已记住：图测条目' });
    const q = await new MemoryFileStoreService(MEMORY_ROOT).readQueue(14);
    expect(q.map((e) => e.title)).toContain('图测条目');
  });
});


/* ==========================================================
   确认门真图测试（confirm 节点 interrupt/resume）：
   确认与执行分离后的关键契约——
   1. 未授权回测先走 confirm 节点 interrupt，不进引擎；
   2. 同批多组逐组确认时，已确认的组不因节点重跑而重复执行引擎（拆节点前为 O(K²)）；
   3. "授权调优"一次 resume 放行本批全部组；
   4. feedback → 取消回执回模型，引擎不执行；
   5. 参数缺调仓间隔 → 澄清信号回执，不弹确认窗。
   通过 buildGraph 注入 stub agent（脚本化 AIMessage 序列），不依赖真实 GLM。
   ========================================================== */

const FAKE_OUTPUT = {
  card: { type: 'backtest' as const, title: '测试卡', tag: '', curve: [100, 101], benchCurve: [100, 100.5], metrics: [] },
  summary: { ok: true, 年化收益: '+1.0%' },
  metrics: { annual: 1, drawdown: -1, sharpe: 1, winRate: 50 },
};

const LEGAL_ARGS = { startDate: '20240101', endDate: '20241231', rebalanceIntervalDays: 21 };

/** 无 Key 构造 + stub agent 注入 buildGraph（绕过真实 GLM），返回图与全部 stub */
function buildTestGraph() {
  const backtest = {
    preflight: jest.fn(),
    checkRange: jest.fn().mockResolvedValue({ dates: [20240101, 20241231], min: 20200101, max: 20261231 }),
    runStrategyBacktest: jest.fn().mockResolvedValue(FAKE_OUTPUT),
  };
  const factorAnalysis = {
    runRankAnalysis: jest.fn(),
    runFactorCorrelation: jest.fn(),
  };
  const service = new LangGraphAgentService(
    { get: () => undefined } as unknown as ConfigService,
    {} as FactorDataService,
    backtest as unknown as StrategyBacktestService,
    factorAnalysis as unknown as FactorAnalysisService,
    new MemoryUserStoreService(),
    new MemoryFileStoreService(MEMORY_ROOT),
  );
  const agent = { invoke: jest.fn() };
  const app = (service as unknown as { buildGraph(a: unknown): { invoke(input: object, config?: object): Promise<Record<string, unknown>> } }).buildGraph(agent);
  return { app, agent, backtest, factorAnalysis, service };
}

/** 图入口：模拟 runGraph 的入口协议——userText 精确为"授权调优"时以已授权状态启动
 *  （真实逻辑在 service.runGraph，helper 按同一协议注入初始状态） */
function start(app: ReturnType<typeof buildTestGraph>['app'], threadId: string, userText = '回测') {
  return app.invoke(
    {
      conversationId: 'spec-conv',
      userText,
      ...(userText.trim() === '授权调优' ? { backtestDelegated: true } : {}),
      messages: [new HumanMessage(userText)],
    },
    { configurable: { thread_id: threadId }, recursionLimit: 25 },
  );
}

function withCalls(text: string, calls: { id: string; args: object }[]): AIMessage {
  return withToolCalls('run_strategy_backtest', text, calls);
}

/** 泛化版：指定工具名的 tool_calls 消息（排名分析/相关性用例用） */
function withToolCalls(name: string, text: string, calls: { id: string; args: object }[]): AIMessage {
  return new AIMessage({ content: text, tool_calls: calls.map((c) => ({ name, args: c.args, id: c.id, type: 'tool_call' as const })) });
}

function finalText(text: string): AIMessage {
  return new AIMessage({ content: text });
}

function interruptParams(state: Record<string, unknown>): Record<string, string> {
  const interrupted = (state as { __interrupt__?: Array<{ value: { params?: Record<string, string> } }> }).__interrupt__;
  expect(interrupted?.length).toBeGreaterThan(0);
  return interrupted![0].value.params ?? {};
}

describe('确认门真图（confirm 节点 interrupt/resume）', () => {
  it('单组回测：confirm 挂起 → 确认 → 引擎恰好执行一次并出卡', async () => {
    const { app, agent, backtest } = buildTestGraph();
    agent.invoke
      .mockResolvedValueOnce(withCalls('发起回测', [{ id: 'call_1', args: LEGAL_ARGS }]))
      .mockResolvedValueOnce(finalText('回测完成'));

    const pending = await start(app, 't-single');
    expect(backtest.runStrategyBacktest).not.toHaveBeenCalled(); // 挂起时不进引擎
    expect(interruptParams(pending)['回测区间']).toBe('20240101~20241231');

    const done = await app.invoke(new Command({ resume: { action: 'approve' } }), {
      configurable: { thread_id: 't-single' }, recursionLimit: 25,
    });
    expect(backtest.runStrategyBacktest).toHaveBeenCalledTimes(1); // 不因节点重跑而重复执行
    expect(backtest.preflight).toHaveBeenCalled();
    const doneMsgs = done.messages as BaseMessage[];
    const toolMsgs = doneMsgs.filter((m) => m instanceof ToolMessage);
    expect(toolMsgs).toHaveLength(1);
    expect((done as { card?: { type: string } }).card?.type).toBe('backtest');
    // checkpoint 序列化后消息是新实例，验证内容而非引用：最后一条是 agent 的最终回复
    const lastMsg = (done.messages as BaseMessage[]).at(-1) as AIMessage;
    expect(lastMsg.content).toBe('回测完成');
  });

  it('排名分析：confirm 挂起（分析参数）→ 确认 → 分析执行并出排名卡', async () => {
    const { app, agent, factorAnalysis } = buildTestGraph();
    agent.invoke
      .mockResolvedValueOnce(
        withToolCalls('run_rank_analysis', '跑排名', [
          {
            id: 'ra_1',
            args: {
              factor: { table: 'equ_factor_obos', field: 'REVS20', direction: 1 },
              intervalDays: 5, startDate: '20240101', endDate: '20241231',
            },
          },
        ]),
      )
      .mockResolvedValueOnce(finalText('分析完成'));
    factorAnalysis.runRankAnalysis.mockResolvedValue({
      icSeries: [{ date: 20240102, ic: 0.42 }],
      icMean: 0.42, icPositiveProb: 100, icIR: undefined,
      segmentMeanReturnPct: [3, -1], segmentCumulativePct: [12, -4],
      monotonicityR2: 0.98, longShortSpreadPct: 4, periodCount: 3,
    });

    const pending = await start(app, 't-rank');
    expect(factorAnalysis.runRankAnalysis).not.toHaveBeenCalled(); // 挂起时不进分析
    expect(interruptParams(pending)['分析类型']).toContain('排名分析');
    expect(interruptParams(pending)['分段数']).toBe('5 段（默认）');
    expect(interruptParams(pending)['分析间隔']).toBe('每 5 个交易日');

    const done = await app.invoke(new Command({ resume: { action: 'approve' } }), {
      configurable: { thread_id: 't-rank' }, recursionLimit: 25,
    });
    expect(factorAnalysis.runRankAnalysis).toHaveBeenCalledTimes(1);
    expect((done as { card?: { type: string } }).card?.type).toBe('rank_analysis');
  });

  it('同批两组逐组确认：每组各 interrupt 一次，引擎共执行两次（不重跑已确认组）', async () => {
    const { app, agent, backtest } = buildTestGraph();
    agent.invoke
      .mockResolvedValueOnce(withCalls('对比', [
        { id: 'call_1', args: LEGAL_ARGS },
        { id: 'call_2', args: { ...LEGAL_ARGS, rebalanceIntervalDays: 10 } },
      ]))
      .mockResolvedValueOnce(finalText('组2更优'));

    const first = await start(app, 't-two');
    expect(interruptParams(first)['调仓间隔']).toBe('每 21 个交易日');

    // 确认第一组 → confirm 重跑（组1 回放 approve）→ 组2 interrupt
    const second = await app.invoke(new Command({ resume: { action: 'approve' } }), {
      configurable: { thread_id: 't-two' }, recursionLimit: 25,
    });
    expect(backtest.runStrategyBacktest).not.toHaveBeenCalled(); // 组1 确认后不会先跑一遍再被重跑
    expect(interruptParams(second)['调仓间隔']).toBe('每 10 个交易日');

    // 确认第二组 → 两组全部放行 → 引擎各执行一次
    await app.invoke(new Command({ resume: { action: 'approve' } }), {
      configurable: { thread_id: 't-two' }, recursionLimit: 25,
    });
    expect(backtest.runStrategyBacktest).toHaveBeenCalledTimes(2);
    const runArgs = backtest.runStrategyBacktest.mock.calls.map((c) => (c[0] as { rebalanceIntervalDays: number }).rebalanceIntervalDays);
    expect(runArgs.sort()).toEqual([10, 21]);
  });

  it('授权调优：一次 resume 放行本批全部组，回执带授权模式', async () => {
    const { app, agent, backtest } = buildTestGraph();
    agent.invoke
      .mockResolvedValueOnce(withCalls('连续三组', [
        { id: 'call_1', args: LEGAL_ARGS },
        { id: 'call_2', args: { ...LEGAL_ARGS, rebalanceIntervalDays: 10 } },
        { id: 'call_3', args: { ...LEGAL_ARGS, rebalanceIntervalDays: 5 } },
      ]))
      .mockResolvedValueOnce(finalText('择优完成'));

    await start(app, 't-delegate');
    const done = await app.invoke(new Command({ resume: { action: 'delegate' } }), {
      configurable: { thread_id: 't-delegate' }, recursionLimit: 25,
    });
    // 一次 resume 后图直通 END：三组全执行、无第二次 interrupt
    expect((done as { __interrupt__?: unknown[] }).__interrupt__).toBeUndefined();
    expect(backtest.runStrategyBacktest).toHaveBeenCalledTimes(3);
    const toolMsgs = (done.messages as BaseMessage[]).filter((m) => m instanceof ToolMessage);
    expect(toolMsgs.some((m) => String((m as ToolMessage).content).includes('授权模式'))).toBe(true);
  });

  it('feedback：取消回执回模型，引擎不执行', async () => {
    const { app, agent, backtest } = buildTestGraph();
    agent.invoke
      .mockResolvedValueOnce(withCalls('发起回测', [{ id: 'call_1', args: LEGAL_ARGS }]))
      .mockResolvedValueOnce(finalText('好的，不再回测'));

    await start(app, 't-feedback');
    await app.invoke(new Command({ resume: { action: 'feedback', text: '改成周频' } }), {
      configurable: { thread_id: 't-feedback' }, recursionLimit: 25,
    });
    expect(backtest.runStrategyBacktest).not.toHaveBeenCalled();
    // 第二轮 agent 收到的上下文里含取消回执（模型据此改参重发或放弃）
    const secondTurnMessages = agent.invoke.mock.calls[1][0] as BaseMessage[];
    const cancelled = secondTurnMessages.find(
      (m) => m instanceof ToolMessage && String((m as ToolMessage).content).includes('用户未确认本次回测'),
    );
    expect(cancelled).toBeDefined();
    expect((cancelled as ToolMessage).content).toContain('改成周频');
  });

  it('入口消息"授权调优"：以已授权状态启动图执行，多组回测直接执行不弹窗', async () => {
    const { app, agent, backtest } = buildTestGraph();
    agent.invoke
      .mockResolvedValueOnce(withCalls('响应授权', [
        { id: 'call_1', args: LEGAL_ARGS },
        { id: 'call_2', args: { ...LEGAL_ARGS, rebalanceIntervalDays: 10 } },
      ]))
      .mockResolvedValueOnce(finalText('择优完成'));

    const done = await start(app, 't-entry-delegate', '授权调优');
    // 不经 confirm 挂起，直达 tools 执行全部组
    expect((done as { __interrupt__?: unknown[] }).__interrupt__).toBeUndefined();
    expect(backtest.runStrategyBacktest).toHaveBeenCalledTimes(2);
    // 授权只活本次图执行：回执带授权模式标注
    const toolMsgs = (done.messages as BaseMessage[]).filter((m) => m instanceof ToolMessage);
    expect(toolMsgs.some((m) => String((m as ToolMessage).content).includes('授权模式'))).toBe(true);
  });

  it('缺调仓间隔：澄清信号回执直通模型，不弹确认窗', async () => {
    const { app, agent, backtest } = buildTestGraph();
    agent.invoke
      .mockResolvedValueOnce(withCalls('发起回测', [{ id: 'call_1', args: { startDate: '20240101', endDate: '20241231' } }]))
      .mockResolvedValueOnce(finalText('请问您希望多久调仓一次？'));

    const done = await start(app, 't-clarify');
    expect((done as { __interrupt__?: unknown[] }).__interrupt__).toBeUndefined(); // 不挂起、不弹窗
    expect(backtest.runStrategyBacktest).not.toHaveBeenCalled();
    const toolMsgs = (done.messages as BaseMessage[]).filter((m) => m instanceof ToolMessage);
    expect((toolMsgs[0] as ToolMessage).content).toContain('需要澄清');
  });
});

/* ==========================================================
   token 减负投影（prompt 分支）：表目录哨兵撤除 + 旧行回执摘要化。
   投影只发生在喂模型边界，图状态保持全量——这里只测纯函数本身。
   ========================================================== */

describe('token 减负投影（prompt 分支）', () => {
  const SYS = '你是因子智投。\n\n【表目录开始】\n表甲 因子表说明\n表乙 行情表说明\n【表目录结束】';

  const aiRound = (id: string) =>
    new AIMessage({ content: '', tool_calls: [{ id, name: 'run_strategy_backtest', args: {} }] });
  const tm = (id: string, content: string) => new ToolMessage({ content, tool_call_id: id });

  it('stripTableCatalog：撤除哨兵段保留正文；无哨兵原样返回', () => {
    const stripped = stripTableCatalog(SYS);
    expect(stripped).not.toContain('表目录开始');
    expect(stripped).not.toContain('表甲');
    expect(stripped).toContain('你是因子智投。');
    expect(stripTableCatalog('没有哨兵的普通提示')).toBe('没有哨兵的普通提示');
  });

  it('summarizeToolReceipt：回测回执抽卡片编号+核心指标；非 JSON 截断兜底', () => {
    const s = summarizeToolReceipt(
      JSON.stringify({ ok: true, 卡片编号: 'card_1', 年化收益: '12.3%', 最大回撤: '-8.1%', 排序因子: 'REVS20' }),
    );
    expect(s).toContain('card_1');
    expect(s).toContain('年化收益=12.3%');
    expect(s).toContain('排序因子=REVS20');
    expect(s).toContain('get_backtest_run');
    expect(summarizeToolReceipt('纯文本回执'.repeat(30))).toContain('【历史回执摘要】');
    expect(summarizeToolReceipt('纯文本回执'.repeat(30)).length).toBeLessThan(180);
  });

  it('首轮调用：保留表目录，最后一轮回执原样，旧行回执摘要化且 tool_call_id 配对', () => {
    const msgs = [
      new SystemMessage(SYS),
      new HumanMessage('帮我回测'),
      aiRound('c1'),
      tm('c1', JSON.stringify({ 卡片编号: 'card_1', 年化收益: '12.3%' })),
      aiRound('c2'),
      tm('c2', '本轮即时回执原文'),
    ];
    const out = projectMessagesForModel(msgs, true);
    expect(String((out[0] as SystemMessage).content)).toContain('【表目录开始】');
    const old = out[3] as ToolMessage;
    expect(old.content).toContain('【历史回执摘要】');
    expect(old.content).toContain('card_1');
    expect(old.tool_call_id).toBe('c1');
    expect((out[5] as ToolMessage).content).toBe('本轮即时回执原文');
  });

  it('非首轮调用：撤除表目录正文；旧行回执仍摘要化', () => {
    const msgs = [
      new SystemMessage(SYS),
      new HumanMessage('继续'),
      aiRound('c1'),
      tm('c1', JSON.stringify({ 卡片编号: 'card_1' })),
      aiRound('c2'),
      tm('c2', '最新回执'),
    ];
    const out = projectMessagesForModel(msgs, false);
    expect(String((out[0] as SystemMessage).content)).not.toContain('表目录开始');
    expect(String((out[0] as SystemMessage).content)).toContain('你是因子智投。');
    expect((out[3] as ToolMessage).content).toContain('【历史回执摘要】');
  });

  it('无工具轮的普通消息流原样返回', () => {
    const msgs = [new SystemMessage('无目录提示'), new HumanMessage('你好')];
    expect(projectMessagesForModel(msgs, true)).toEqual(msgs);
  });
});


/* ==========================================================
   并发治理 C1（限流退避 + 挂起恢复 + 确认门限流保留）+ LangGraph 恢复语义
   ========================================================== */

describe('isGlmRateLimitError（限流判定）', () => {
  it('识别 429 状态码 / 消息信号 / 速率限制文案；其他错误不误判', () => {
    expect(isGlmRateLimitError(new Error('429 您的账户已达到速率限制'))).toBe(true);
    expect(isGlmRateLimitError(new Error('调用返回「Rate limit reached」'))).toBe(true);
    expect(isGlmRateLimitError(new Error('RateLimitCapacityError: 超出'))).toBe(true);
    expect(isGlmRateLimitError(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(isGlmRateLimitError(new Error('500 Internal Server Error'))).toBe(false);
    expect(isGlmRateLimitError(new Error('参数不完整'))).toBe(false);
  });
});

describe('withLlmSlot（信号量 + 限流退避重试）', () => {
  function serviceWithSlot(): { service: LangGraphAgentService; runner: <T>(fn: () => Promise<T>) => Promise<T> } {
    const service = newService();
    (service as unknown as { llmRetryMax: number }).llmRetryMax = 3;
    (service as unknown as { llmBackoffBaseMs: number }).llmBackoffBaseMs = 1;
    const runner = <T,>(fn: () => Promise<T>): Promise<T> =>
      (service as unknown as { withLlmSlot(f: () => Promise<T>): Promise<T> }).withLlmSlot(fn);
    return { service, runner };
  }

  it('429 两次后成功：自动重试并返回', async () => {
    const { runner } = serviceWithSlot();
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new Error('429 您的账户已达到速率限制');
      return 'ok';
    };
    await expect(runner(fn)).resolves.toBe('ok');
    expect(calls).toBe(3);
  });

  it('重试耗尽：抛出原错误（初始 + retryMax 次尝试）', async () => {
    const { runner } = serviceWithSlot();
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('429 速率限制');
    };
    await expect(runner(fn)).rejects.toThrow('429');
    expect(calls).toBe(4); // 初始 1 + 重试 3
  });

  it('非限流错误不重试：一次抛出', async () => {
    const { runner } = serviceWithSlot();
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('参数不完整');
    };
    await expect(runner(fn)).rejects.toThrow('参数不完整');
    expect(calls).toBe(1);
  });

  it('并发上限：5 个并行任务在飞峰值 = 2', async () => {
    const service = newService();
    let active = 0;
    let peak = 0;
    const fn = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
    };
    const slots = (service as unknown as { withLlmSlot(f: () => Promise<void>): Promise<void> });
    await Promise.all(Array.from({ length: 5 }, () => slots.withLlmSlot(fn)));
    expect(peak).toBe(2);
  });
});

describe('LangGraph 断点恢复语义（真实 StateGraph + MemorySaver，挂起恢复的支撑事实）', () => {
  const VerifyState = Annotation.Root({
    messages: Annotation<BaseMessage[]>({
      reducer: (a, b) => a.concat(b),
      default: () => [],
    }),
  });

  function buildVerifyGraph() {
    const checkpointer = new MemorySaver();
    let bCalls = 0;
    const seen: string[][] = [];
    const graph = new StateGraph(VerifyState)
      .addNode('a', async () => ({ messages: [new AIMessage('A完成')] }))
      .addNode('b', async (state: typeof VerifyState.State) => {
        bCalls++;
        seen.push(state.messages.map((m) => String(m.content)));
        if (bCalls === 1) throw new Error('429 您的账户已达到速率限制');
        return { messages: [new AIMessage('B完成')] };
      })
      .addEdge(START, 'a')
      .addEdge('a', 'b')
      .addEdge('b', END)
      .compile({ checkpointer });
    const thread = (id: string) => ({ configurable: { thread_id: id } });
    return { graph, thread, seen, calls: () => bCalls };
  }

  it('节点抛错：检查点停在最后完成节点（回执在场、next=[失败节点]）', async () => {
    const { graph, thread } = buildVerifyGraph();
    const t = thread('v1');
    await expect(graph.invoke({ messages: [new HumanMessage('开始')] }, t)).rejects.toThrow('429');
    const snap = await graph.getState(t);
    expect((snap.values as { messages: BaseMessage[] }).messages.map((m) => String(m.content))).toEqual(['开始', 'A完成']);
    expect(snap.next).toEqual(['b']);
  });

  it('invoke(null)：从检查点只重跑失败节点（已完成节点不重跑）', async () => {
    const { graph, thread, calls } = buildVerifyGraph();
    const t = thread('v2');
    await expect(graph.invoke({ messages: [new HumanMessage('开始')] }, t)).rejects.toThrow('429');
    const r = await graph.invoke(null, t);
    expect(r.messages.map((m) => String(m.content))).toEqual(['开始', 'A完成', 'B完成']);
    expect(calls()).toBe(2);
  });

  it('invoke(带新消息)：新消息并入检查点、整链重跑（thread 复用续跑的支撑语义）', async () => {
    const { graph, thread, seen } = buildVerifyGraph();
    const t = thread('v3');
    await expect(graph.invoke({ messages: [new HumanMessage('开始')] }, t)).rejects.toThrow('429');
    const r = await graph.invoke({ messages: [new HumanMessage('继续')] }, t);
    // 失败节点重跑时：已完成节点的产出与新消息都在上下文（模型自行决定继续/调整/回答）
    expect(seen.at(-1)).toEqual(['开始', 'A完成', '继续', 'A完成']);
    expect(r.messages.map((m) => String(m.content))).toContain('继续');
  });
});

describe('限流耗尽挂起恢复（C1 断点续跑，runGraph 级）', () => {
  const convOf = (id: string): Conversation => ({ id, title: '', messages: [], updatedAt: 0 });
  type RunGraph = { runGraph(c: Conversation, text: string): Promise<{ text: string }> };

  it('限流耗尽：检查点保留 + pendingResumes 登记 + 回复引导；「继续」复用 thread 简化组装完成', async () => {
    const { app, agent, backtest, service } = buildTestGraph();
    (service as unknown as { llm: unknown }).llm = { invoke: jest.fn() };
    (service as unknown as { app: unknown }).app = app;
    Object.assign(service as unknown as Record<string, number>, { llmRetryMax: 1, llmBackoffBaseMs: 1 });
    const runner = service as unknown as RunGraph;
    const pending = () => (service as unknown as { pendingResumes: Map<string, string> }).pendingResumes;

    agent.invoke
      .mockRejectedValueOnce(new Error('429 您的账户已达到速率限制')) // 首次：限流
      .mockRejectedValueOnce(new Error('429 您的账户已达到速率限制')) // 重试 1/1：仍限流 → 耗尽
      .mockResolvedValueOnce(finalText('断点分析完成')); // 下一问恢复：直接出总结

    const first = await runner.runGraph(convOf('c-resume'), '回测XX');
    expect(first.text).toContain('进度已保存');
    expect(first.text).toContain('直接回复即可继续');
    expect(pending().has('c-resume')).toBe(true);

    const resumed = await runner.runGraph(convOf('c-resume'), '继续');
    expect(resumed.text).toBe('断点分析完成');
    // 简化组装 + 检查点恢复：stub 收到的消息 = 首轮 system（检查点沿用）+ 首问 +「继续」（追加），
    // 无历史窗口/记忆重组——现场与新消息都在，GLM 自行完成剩余任务
    const resumedInput = agent.invoke.mock.calls[2][0] as BaseMessage[];
    const contents = resumedInput.map((m) => String(m.content));
    expect(contents[0]).toContain('因子智投');
    expect(contents.at(-2)).toBe('回测XX');
    expect(contents.at(-1)).toBe('继续');
    expect(pending().has('c-resume')).toBe(false);
    expect(backtest.runStrategyBacktest).not.toHaveBeenCalled(); // 续跑零工具重跑
  });

  it('非「继续」消息：弃断点走正常新提问流程', async () => {
    const { app, agent, service } = buildTestGraph();
    (service as unknown as { llm: unknown }).llm = { invoke: jest.fn() };
    (service as unknown as { app: unknown }).app = app;
    Object.assign(service as unknown as Record<string, number>, { llmRetryMax: 1, llmBackoffBaseMs: 1 });
    const runner = service as unknown as RunGraph;
    const pending = () => (service as unknown as { pendingResumes: Map<string, string> }).pendingResumes;

    agent.invoke
      .mockRejectedValueOnce(new Error('429 速率限制'))
      .mockRejectedValueOnce(new Error('429 速率限制'))
      .mockResolvedValueOnce(finalText('新问题的回答'));

    await runner.runGraph(convOf('c-abandon'), '回测XX');
    expect(pending().has('c-abandon')).toBe(true);

    const second = await runner.runGraph(convOf('c-abandon'), '帮我查个数据');
    expect(second.text).toBe('新问题的回答');
    expect(pending().has('c-abandon')).toBe(false); // 断点弃置
  });
});

/* ==========================================================
   展示卡标记行（卡片错位修复）：【最优组: card_N】解析
   - 括号字面量子串匹配（黏行/独立行都算），不猜散文；重复取最后一个；
   - 命中后剥离标记子串；无标记/格式不符 → 原文返回、seq=null（回落卡片通道）。
   ========================================================== */
describe('extractBestCardMarker（展示卡标记行解析）', () => {
  it('命中：提取编号并剥离标记行', () => {
    const text = '本轮调优结果对比：\n\n最优组为 card_9。\n\n【最优组: card_9】';
    const { text: out, seq, markerCount } = extractBestCardMarker(text);
    expect(seq).toBe(9);
    expect(markerCount).toBe(1);
    expect(out).toBe('本轮调优结果对比：\n\n最优组为 card_9。');
  });

  it('无标记：原文原样返回', () => {
    const text = '回测完成，年化 +4.1%。';
    const { text: out, seq, markerCount } = extractBestCardMarker(text);
    expect(seq).toBeNull();
    expect(markerCount).toBe(0);
    expect(out).toBe(text);
  });

  it('重复标记：取最后一个，全部剥离', () => {
    const text = '对比见上。【最优组: card_4】\n【最优组: card_10】';
    const { text: out, seq, markerCount } = extractBestCardMarker(text);
    expect(seq).toBe(10);
    expect(markerCount).toBe(2);
    expect(out).toBe('对比见上。');
  });

  it('黏在行尾的标记同样命中（只剥离子串，保留前文）', () => {
    const { text: out, seq, markerCount } = extractBestCardMarker('最优组为 card_9【最优组: card_9】');
    expect(seq).toBe(9);
    expect(markerCount).toBe(1);
    expect(out).toBe('最优组为 card_9');
  });

  it('格式不符不命中：缺编号/无括号散文/旧标记/标签不同', () => {
    for (const bad of [
      '【最优组: card】', // 缺编号
      '最优组为 card_9', // 无括号散文
      '【展示卡片: card_9】', // 旧标记（已废除）
      '【最佳组: card_9】', // 标签不同
    ]) {
      const { seq, markerCount } = extractBestCardMarker(bad);
      expect(seq).toBeNull();
      expect(markerCount).toBe(0);
    }
  });

  it('全角冒号与首尾空格变体命中', () => {
    const { seq } = extractBestCardMarker('结论如上。\n 【最优组：card_12】 ');
    expect(seq).toBe(12);
  });
});
