import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ConfigService } from '@nestjs/config';
import { Conversation } from '../../../src/types';
import {
  applyCardSelection,
  formatTableCatalog,
  LangGraphAgentService,
} from '../../../src/agent/implementations/langgraph-agent.service';
import { FactorDataService } from '../../../src/core/factor-data.service';
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
  return new LangGraphAgentService(config, {} as FactorDataService, {} as StrategyBacktestService);
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
