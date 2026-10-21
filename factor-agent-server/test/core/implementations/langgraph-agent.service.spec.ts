import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { ConfigService } from '@nestjs/config';
import { MemoryUserStoreService } from '../../../src/core/implementations/memory-user-store.service';import { Conversation } from '../../../src/types';
import {
  applyCardSelection,
  formatTableCatalog,
  LangGraphAgentService,
} from '../../../src/agent/implementations/langgraph-agent.service';
import { FactorDataService } from '../../../src/core/factor-data.service';
import { FactorAnalysisService } from '../../../src/core/factor-analysis.service';
import { StrategyBacktestService } from '../../../src/core/strategy-backtest.service';

/* ==========================================================
   智能体 system prompt 拼装单元测试：表目录注入 + 数据会话门
   - 无 Key 构造（开发模式，不建 LLM），只测 prompt 组装逻辑；
   - 目录读仓库内真实 SQL/tables.md（与 factor-schema.spec 同口径）；
   - 门语义：未执行过因子工具的会话不带目录（探索指令），
     dataConversations 中的会话带目录原文、免探索直达字段/读数/回测。
   ========================================================== */

/** 无 Key 配置：get 恒 undefined → 开发模式分支，不创建 LLM 与图 */
function newService(): LangGraphAgentService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new LangGraphAgentService(config, {} as FactorDataService, {} as StrategyBacktestService, {} as FactorAnalysisService, new MemoryUserStoreService());
}

function conv(id: string): Conversation {
  return { id, title: '', messages: [], updatedAt: 0 };
}

/** 私有成员的两个类型安全访问口径 */
type PromptBuilder = { prepareMessages(c: Conversation, text: string): BaseMessage[] };
type Gate = { dataConversations: Set<string> };

function systemOf(service: LangGraphAgentService, id: string): string {
  const builder = service as unknown as PromptBuilder;
  const messages = builder.prepareMessages(conv(id), '你好');
  const last = messages[messages.length - 1];
  expect(last).toBeInstanceOf(HumanMessage);
  expect((last as HumanMessage).content).toBe('你好');
  expect(messages[0]).toBeInstanceOf(SystemMessage);
  return String((messages[0] as SystemMessage).content);
}

describe('LangGraphAgentService（表目录注入 + 数据会话门）', () => {
  it('未执行过因子工具的会话：system 走探索指令，不注入目录块', () => {
    const service = newService();
    const system = systemOf(service, 'conv-fresh');
    expect(system).toContain('先 list_factor_tables 看有哪些表');
    expect(system).toContain('list_factor_fields 看因子字段');
    expect(system).not.toContain('【数据表目录】');
    expect(system).not.toContain('直接从中选定数据表');
  });

  it('进门的会话（执行过任一因子工具）：system 注入目录原文，指令改为直接选表', () => {
    const service = newService();
    (service as unknown as Gate).dataConversations.add('conv-data');
    const system = systemOf(service, 'conv-data');
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

describe('applyCardSelection（多次回测择优：展示卡片标记解析）', () => {
  const card1 = { type: 'backtest' as const, title: '第一次', tag: '', curve: [100], benchCurve: [100], metrics: [] };
  const card2 = { type: 'backtest' as const, title: '第二次', tag: '', curve: [100], benchCurve: [100], metrics: [] };
  const registry = { card_1: card1, card_2: card2 };
  const card0 = { type: 'backtest' as const, title: '默认卡', tag: '', curve: [100], benchCurve: [100], metrics: [] };

  it('标记命中：选用注册表对应卡片，标记行从文案剔除', () => {
    const r = applyCardSelection('低波动四因子年化 +21.9%。\n【展示卡片:card_2】\n不构成投资建议。', registry, card0);
    expect(r.card).toBe(card2);
    expect(r.text).not.toContain('【展示卡片');
    expect(r.text).toContain('不构成投资建议');
    expect(r.markerId).toBe('card_2');
  });

  it('全角冒号与空格兼容', () => {
    const r = applyCardSelection('总结。【展示卡片 ： card_1 】', registry);
    expect(r.card).toBe(card1);
    expect(r.text).toBe('总结。');
  });

  it('编号无效：回落默认卡，标记行仍剔除', () => {
    const r = applyCardSelection('结果 +x%。【展示卡片:card_9】', registry, card0);
    expect(r.card).toBe(card0);
    expect(r.text).not.toContain('【展示卡片');
    expect(r.markerId).toBe('card_9');
  });

  it('未标记：原样返回文案与默认卡', () => {
    const r = applyCardSelection('普通总结。', registry, card0);
    expect(r.text).toBe('普通总结。');
    expect(r.card).toBe(card0);
    expect(r.markerId).toBeUndefined();
  });

  it('未标记且无默认卡：card 为 undefined（纯文本回复）', () => {
    const r = applyCardSelection('你好呀。', registry);
    expect(r.text).toBe('你好呀。');
    expect(r.card).toBeUndefined();
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
  );
  const agent = { invoke: jest.fn() };
  const app = (service as unknown as { buildGraph(a: unknown): { invoke(input: object, config?: object): Promise<Record<string, unknown>> } }).buildGraph(agent);
  return { app, agent, backtest, factorAnalysis };
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
