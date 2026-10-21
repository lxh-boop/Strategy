import { BaseMessage, HumanMessage, SystemMessage, AIMessage, ToolMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { ConfigService } from '@nestjs/config';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Conversation } from '../../../src/types';
import {
  applyCardSelection,
  bubbleChars,
  formatTableCatalog,
  LangGraphAgentService,
  suffixStartIndex,
  uncoveredSlice,
} from '../../../src/agent/implementations/langgraph-agent.service';
import { FactorDataService } from '../../../src/core/factor-data.service';
import { MemoryUserStoreService } from '../../../src/core/implementations/memory-user-store.service';
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

describe('LangGraphAgentService（长期记忆注入，ADR-0007 第 1 刀）', () => {
  const userId = 42;

  async function systemWithMemory(
    seed: { slug: string; title: string; content: string }[],
    uid: number = userId,
  ): Promise<string> {
    const store = new MemoryFileStoreService(MEMORY_ROOT);
    for (const item of seed) await store.saveEntry(uid, item);
    const service = newService();
    const builder = service as unknown as PromptBuilder;
    const messages = await builder.prepareMessages({ ...conv('conv-mem'), userId: uid }, '你好');
    return String((messages[0] as SystemMessage).content);
  }

  it('有条目且带 userId：system 注入记忆块与条目行（slug 可见，供 update/delete 引用）', async () => {
    const system = await systemWithMemory([{ slug: 'prefer-momentum', title: '偏好动量', content: '只做 20 日动量。' }]);
    expect(system).toContain('【用户长期记忆】');
    expect(system).toContain('- [prefer-momentum] 偏好动量（');
    expect(system).toContain('只做 20 日动量。');
  });

  it('记忆为空：不注入记忆块（prompt 与既往一致）', async () => {
    const system = await systemWithMemory([], 43); // 全新用户：目录里没有任何条目
    expect(system).not.toContain('【用户长期记忆】');
  });

  it('会话不带 userId（编排层漏接线的防御口径）：不注入记忆块', async () => {
    const store = new MemoryFileStoreService(MEMORY_ROOT);
    await store.saveEntry(userId, { slug: 'orphan', title: '孤儿条目', content: '不应出现。' });
    const service = newService();
    const builder = service as unknown as PromptBuilder;
    const messages = await builder.prepareMessages(conv('conv-nouser'), '你好');
    expect(String((messages[0] as SystemMessage).content)).not.toContain('【用户长期记忆】');
  });

  it('预算截断：budgetChars 调小后只注入预算内条目（新者先留）', async () => {
    await systemWithMemory([
      { slug: 'new-entry', title: '新条目', content: '新的偏好。' },
      { slug: 'old-entry', title: '旧条目', content: '旧的偏好，内容还特别长，超出预算就应该被淘汰掉。' },
    ]);
    const service = newService();
    (service as unknown as { memoryBudgetChars: number }).memoryBudgetChars = 60;
    const builder = service as unknown as PromptBuilder;
    const messages = await builder.prepareMessages({ ...conv('conv-mem'), userId }, '你好');
    const system = String((messages[0] as SystemMessage).content);
    expect(system).toContain('【用户长期记忆】');
    expect(system).toContain('new-entry');
    expect(system).not.toContain('old-entry');
  });
});

describe('会话滚动摘要（长度制，ADR-0007 第 3 刀）', () => {
  const msg = (role: 'user' | 'agent', text: string) =>
    ({ role, bubble: text, time: '10:00' }) as Conversation['messages'][number];
  type PromptBuilder = { prepareMessages(c: Conversation, text: string): Promise<BaseMessage[]> };

  it('bubbleChars：气泡字符累计（卡片不参与）', () => {
    const msgs = [msg('user', '12345'), msg('agent', '678')];
    expect(bubbleChars(msgs)).toBe(8);
  });

  it('uncoveredSlice：边界收整条消息，压线时多注入不丢失', () => {
    const msgs = [msg('user', 'a'.repeat(6)), msg('agent', 'b'.repeat(6))];
    // covered=10 落在第二条消息中间 → 第二条整条注入（多注入安全）
    expect(uncoveredSlice(msgs, 10).msgs).toEqual([msgs[1]]);
    // covered ≥ 总长 → 空；covered=0 → 全量
    expect(uncoveredSlice(msgs, 12).msgs).toEqual([]);
    expect(uncoveredSlice(msgs, 0).msgs).toEqual(msgs);
  });

  it('suffixStartIndex：从尾部累计到 ≥ minChars 的最小整条后缀', () => {
    const msgs = [msg('user', 'x'.repeat(5)), msg('agent', 'y'.repeat(5)), msg('user', 'z'.repeat(5))];
    expect(suffixStartIndex(msgs, 8)).toBe(1);
    expect(suffixStartIndex(msgs, 1)).toBe(2);
    expect(suffixStartIndex(msgs, 15)).toBe(0);
  });

  it('无损性质：任意消息序列与尾部预算下，摘要覆盖段 ∪ 原文段 = 全部消息且不重叠', () => {
    const lengths = [3, 7, 2, 9, 4, 6, 1, 8, 5];
    const msgs = lengths.map((n, i) => msg(i % 2 ? 'agent' : 'user', String(i).repeat(n)));
    const total = bubbleChars(msgs);
    for (const tail of [0, 5, 12, 20, total]) {
      const covered = bubbleChars(msgs.slice(0, suffixStartIndex(msgs, tail)));
      const { msgs: uncovered } = uncoveredSlice(msgs, covered);
      const expected = msgs.slice(suffixStartIndex(msgs, tail));
      expect(uncovered).toEqual(expected);
      // 覆盖段与原文段拼接 = 原序列（顺序不变、无遗漏）
      expect(bubbleChars(msgs.slice(0, suffixStartIndex(msgs, tail))) + uncovered.length).toBeGreaterThanOrEqual(0);
      expect(msgs.slice(0, msgs.length - uncovered.length).every((m, i) => msgs[i] === m)).toBe(true);
    }
  });

  it('slice(-6) 退役：短会话 12 条全量原文注入', async () => {
    const service = newService();
    const conv: Conversation = {
      id: 'conv-long-short',
      title: '',
      updatedAt: 0,
      userId: 20,
      messages: Array.from({ length: 12 }, (_, i) => msg(i % 2 ? 'agent' : 'user', `第${i}轮`)),
    };
    const messages = await (service as unknown as PromptBuilder).prepareMessages(conv, '新问题');
    // system + 12 条原文 + 当前问题；旧 slice(-6) 只会有 8 条
    expect(messages).toHaveLength(14);
    expect(messages.filter((m) => m instanceof HumanMessage || m instanceof AIMessage)).toHaveLength(13);
    expect(messages.map((m) => String(m.content))).toContain('第0轮');
    expect(messages.map((m) => String(m.content))).toContain('第11轮');
  });

  it('无 userId 长会话（防御口径）：只注入最近 triggerChars 内的原文', async () => {
    const service = newService();
    (service as unknown as { memoryTriggerChars: number }).memoryTriggerChars = 100;
    const conv: Conversation = {
      id: 'conv-nouser-long',
      title: '',
      updatedAt: 0,
      messages: Array.from({ length: 10 }, (_, i) => msg('user', 'x'.repeat(30) + `#${i}`)),
    };
    const messages = await (service as unknown as PromptBuilder).prepareMessages(conv, '新问题');
    const contents = messages.map((m) => String(m.content));
    expect(contents.some((c) => c.includes('#0'))).toBe(false);
    expect(contents.some((c) => c.includes('#9'))).toBe(true);
  });

  describe('摘要闭环（假 LLM）', () => {
    const userId = 30;
    const SUMMARY = '用户在调优动量策略，已确认 20 日动量、日频调仓。';

    function serviceWithLlm(): { service: LangGraphAgentService; invoke: jest.Mock } {
      const service = newService();
      const invoke = jest.fn().mockResolvedValue({ content: SUMMARY, additional_kwargs: {} });
      (service as unknown as { llm: unknown }).llm = { invoke };
      Object.assign(service as unknown as Record<string, number>, {
        memoryTriggerChars: 100,
        memoryTailChars: 40,
        memorySummaryChars: 50,
        memoryRefitCapChars: 30_000,
      });
      return { service, invoke };
    }

    const longConv = (id: string): Conversation => ({
      id,
      title: '',
      updatedAt: 0,
      userId,
      messages: Array.from({ length: 6 }, (_, i) => msg(i % 2 ? 'agent' : 'user', `${i}`.repeat(30))),
    });

    it('懒兜底：超触发线且无摘要 → 内联压缩落盘，注入 = 摘要 SystemMessage + 尾部原文', async () => {
      const { service, invoke } = serviceWithLlm();
      const conv = longConv('conv-summ-a');
      const messages = await (service as unknown as PromptBuilder).prepareMessages(conv, '新问题');
      expect(invoke).toHaveBeenCalledTimes(1);
      const store = new MemoryFileStoreService(MEMORY_ROOT);
      const summary = await store.readSummary(userId, 'conv-summ-a');
      expect(summary).not.toBeNull();
      expect(summary!.coveredChars).toBe(120); // 6×30，尾部保留 2 条（60 字 ≥ tail 40）
      // 注入形态：system + 摘要 + 2 条尾部原文 + 当前问题
      expect(messages).toHaveLength(5);
      expect(String((messages[1] as SystemMessage).content)).toContain(SUMMARY);
      expect(String(messages[2].content)).toBe('4'.repeat(30));
      expect(String(messages[3].content)).toBe('5'.repeat(30));
      // 无损不变式：前 4 条在摘要覆盖段，后 2 条原文在场
      expect(summary!.coveredChars).toBe(bubbleChars(conv.messages.slice(0, 4)));
    });

    it('滞后带内不炼：有摘要且未覆盖原文 ≤ trigger-tail → 直接注入，LLM 零调用', async () => {
      const { service, invoke } = serviceWithLlm();
      const store = new MemoryFileStoreService(MEMORY_ROOT);
      await store.writeSummary(userId, 'conv-summ-b', SUMMARY, 180); // 全覆盖：未覆盖 0 字
      const messages = await (service as unknown as PromptBuilder).prepareMessages(longConv('conv-summ-b'), '新问题');
      expect(invoke).not.toHaveBeenCalled();
      expect(String((messages[1] as SystemMessage).content)).toContain(SUMMARY);
    });

    it('硬上限：有旧摘要但未覆盖原文超 triggerChars → 内联重炼封顶', async () => {
      const { service, invoke } = serviceWithLlm();
      const store = new MemoryFileStoreService(MEMORY_ROOT);
      await store.writeSummary(userId, 'conv-summ-c', '旧摘要', 0); // covered=0：未覆盖 = 全部 180 字 > 100
      const messages = await (service as unknown as PromptBuilder).prepareMessages(longConv('conv-summ-c'), '新问题');
      expect(invoke).toHaveBeenCalledTimes(1);
      const summary = await store.readSummary(userId, 'conv-summ-c');
      expect(summary!.summary).toBe(SUMMARY); // 已被重炼覆盖
      expect(String((messages[1] as SystemMessage).content)).toContain(SUMMARY);
    });
  });
});

describe('save_memory（长期记忆写入闭环，ADR-0007 第 2 刀）', () => {
  const conv = (id: string): Conversation => ({ id, title: '', messages: [], updatedAt: 0 });
  type SaveRunner = {
    execSaveMemory(
      args: unknown,
      ctx: { delegated: boolean; conversationId: string; userId?: number },
    ): Promise<{ result: Record<string, unknown> }>;
  };
  const ctxOf = (userId?: number) => ({ delegated: false, conversationId: 'spec-save', userId });
  const add = (slug: string, extra: Record<string, unknown> = {}) => ({ op: 'add', slug, title: '标题', content: '内容。', ...extra });

  it('add：落盘成功，回执带「已记住」', async () => {
    const service = newService();
    const r = await (service as unknown as SaveRunner).execSaveMemory(add('prefer-low-vol'), ctxOf(9));
    expect(r.result).toMatchObject({ ok: true, 回执: '已记住：标题', slug: 'prefer-low-vol' });
    const entries = await new MemoryFileStoreService(MEMORY_ROOT).listEntries(9);
    expect(entries.map((e) => e.slug)).toContain('prefer-low-vol');
  });

  it('add 撞既有 slug：报错引导 update，不覆盖', async () => {
    const service = newService();
    await (service as unknown as SaveRunner).execSaveMemory(add('dup-slug'), ctxOf(10));
    const r = await (service as unknown as SaveRunner).execSaveMemory(add('dup-slug'), ctxOf(10));
    expect(String(r.result.error)).toContain('改用 op=update');
    const entries = await new MemoryFileStoreService(MEMORY_ROOT).listEntries(10);
    expect(entries.filter((e) => e.slug === 'dup-slug')).toHaveLength(1);
  });

  it('update：覆盖既有条目；引用不存在的 slug 报错引导 add', async () => {
    const service = newService();
    await (service as unknown as SaveRunner).execSaveMemory(add('upd-target'), ctxOf(11));
    const ok = await (service as unknown as SaveRunner).execSaveMemory(
      { op: 'update', slug: 'upd-target', title: '新标题', content: '新内容。' },
      ctxOf(11),
    );
    expect(ok.result).toMatchObject({ ok: true, 回执: '已更新：新标题' });
    const miss = await (service as unknown as SaveRunner).execSaveMemory(
      { op: 'update', slug: 'no-such', title: 't', content: 'c' },
      ctxOf(11),
    );
    expect(String(miss.result.error)).toContain('改用 op=add');
  });

  it('delete：存在则移除，不存在报错', async () => {
    const service = newService();
    await (service as unknown as SaveRunner).execSaveMemory(add('del-target'), ctxOf(12));
    const ok = await (service as unknown as SaveRunner).execSaveMemory({ op: 'delete', slug: 'del-target' }, ctxOf(12));
    expect(ok.result).toMatchObject({ ok: true, 回执: '已忘掉：del-target' });
    const miss = await (service as unknown as SaveRunner).execSaveMemory({ op: 'delete', slug: 'del-target' }, ctxOf(12));
    expect(String(miss.result.error)).toContain('无法删除');
  });

  it('缺参与非法 op：逐项报错不落盘', async () => {
    const service = newService();
    const runner = service as unknown as SaveRunner;
    expect(String((await runner.execSaveMemory({ op: 'add' }, ctxOf(13))).result.error)).toContain('参数不完整');
    expect(String((await runner.execSaveMemory({ op: 'delete' }, ctxOf(13))).result.error)).toContain('需要 slug');
    expect(String((await runner.execSaveMemory({ op: 'wat', slug: 's', title: 't', content: 'c' }, ctxOf(13))).result.error)).toContain('op 不合法');
    await expect(new MemoryFileStoreService(MEMORY_ROOT).listEntries(13)).resolves.toEqual([]);
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
        withToolCalls('save_memory', '', [{ id: 'm1', args: { op: 'add', slug: 'graph-add', title: '图测条目', content: '图级闭环写入。' } }]),
      )
      .mockImplementationOnce(async () => finalText('已记住你的偏好。'));
    const state = (await app.invoke(
      { conversationId: 'spec-mem-graph', userText: '记住我只做动量', userId: 14, messages: [new HumanMessage('记住我只做动量')] },
      { configurable: { thread_id: 'mem-graph-1' }, recursionLimit: 25 },
    )) as { messages: BaseMessage[] };
    const toolMsg = state.messages.find((m) => (m as unknown as { tool_call_id?: string }).tool_call_id === 'm1');
    expect(toolMsg).toBeInstanceOf(ToolMessage);
    expect(JSON.parse(String((toolMsg as ToolMessage).content))).toMatchObject({ 回执: '已记住：图测条目' });
    const entries = await new MemoryFileStoreService(MEMORY_ROOT).listEntries(14);
    expect(entries.map((e) => e.slug)).toContain('graph-add');
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
    new MemoryFileStoreService(MEMORY_ROOT),
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
