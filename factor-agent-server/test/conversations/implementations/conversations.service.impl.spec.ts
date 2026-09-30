/* ==========================================================
   B-INT-01 会话业务（ConversationsServiceImpl）单元测试
   UserStoreService / AgentService 均为 mock：不触真实存储、不调 GLM
   运行：npm test
   ========================================================== */
import { Test } from '@nestjs/testing';
import { AgentService } from '../../../src/agent/agent.service';
import { ApiException } from '../../../src/common/api.exception';
import { ConversationsService } from '../../../src/conversations/conversations.service';
import { ConversationsServiceImpl } from '../../../src/conversations/implementations/conversations.service.impl';
import { UserStoreService } from '../../../src/core/user-store.service';
import { AgentReply, ChatMessage, Conversation } from '../../../src/types';

/* 测试数据构造：与 src/types.ts 口径一致 */
const conv = (id: string, messages: ChatMessage[]): Conversation => ({
  id,
  title: '新对话',
  messages,
  updatedAt: Date.now(),
});
const userMsg = (bubble: string): ChatMessage => ({ role: 'user', bubble, time: '10:00' });
const agentMsg = (bubble: string): ChatMessage => ({ role: 'agent', bubble, time: '10:01' });

describe('B-INT-01 ConversationsServiceImpl（会话业务）', () => {
  const USER = 1;
  const store = {
    listConversations: jest.fn(),
    getConversation: jest.fn(),
    newConversation: jest.fn(),
    deleteConversation: jest.fn(),
    clearConversation: jest.fn(),
    appendMessages: jest.fn(),
    renameConversationFromFirstMessage: jest.fn(),
  };
  const agent = { reply: jest.fn(), replyStream: jest.fn() };
  let svc: ConversationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationsServiceImpl,
        { provide: UserStoreService, useValue: store },
        { provide: AgentService, useValue: agent },
      ],
    }).compile();
    svc = moduleRef.get(ConversationsServiceImpl);
  });

  /** 断言 fn 抛出统一契约异常：HTTP 状态码 + error.code */
  async function expectApiError(fn: () => unknown, status: number, code: string): Promise<void> {
    try {
      await fn();
      throw new Error(`期望抛出 ApiException(${code})，实际没有抛出`);
    } catch (e) {
      expect(e).toBeInstanceOf(ApiException);
      expect((e as ApiException).getStatus()).toBe(status);
      expect((e as ApiException).code).toBe(code);
    }
  }

  /* ---------- 透传类方法 ---------- */

  it('list：透传 store.listConversations(userId)', async () => {
    const data = [conv('c1', [])];
    store.listConversations.mockResolvedValue(data);
    expect(await svc.list(USER)).toBe(data);
  });

  it('create：透传 store.newConversation(userId)', async () => {
    const fresh = conv('c2', [agentMsg('欢迎')]);
    store.newConversation.mockResolvedValue(fresh);
    expect(await svc.create(USER)).toBe(fresh);
  });

  /* ---------- 404 语义：会话不存在 ---------- */

  it('remove：删除成功无返回；会话不存在抛 404 NOT_FOUND', async () => {
    store.deleteConversation.mockResolvedValue(true);
    expect(await svc.remove(USER, 'c1')).toBeUndefined();

    store.deleteConversation.mockResolvedValue(false);
    await expectApiError(() => svc.remove(USER, 'nope'), 404, 'NOT_FOUND');
  });

  it('clear：返回清空后的会话；会话不存在抛 404 NOT_FOUND', async () => {
    const cleared = conv('c1', [agentMsg('欢迎')]);
    store.clearConversation.mockResolvedValue(cleared);
    expect(await svc.clear(USER, 'c1')).toBe(cleared);

    store.clearConversation.mockResolvedValue(undefined);
    await expectApiError(() => svc.clear(USER, 'nope'), 404, 'NOT_FOUND');
  });

  it('getMessages：返回该会话的消息数组；会话不存在抛 404 NOT_FOUND', async () => {
    const messages = [userMsg('你好'), agentMsg('你好，我是多因子选股智能体')];
    store.getConversation.mockResolvedValue(conv('c1', messages));
    expect(await svc.getMessages(USER, 'c1')).toBe(messages);

    store.getConversation.mockResolvedValue(undefined);
    await expectApiError(() => svc.getMessages(USER, 'nope'), 404, 'NOT_FOUND');
  });

  /* ---------- sendMessage：编排逻辑 ---------- */

  it('sendMessage：会话不存在抛 404，且不调智能体', async () => {
    store.getConversation.mockResolvedValue(undefined);
    await expectApiError(() => svc.sendMessage(USER, 'nope', '你好'), 404, 'NOT_FOUND');
    expect(agent.reply).not.toHaveBeenCalled();
  });

  it('sendMessage：routeText = 最近 2 条用户消息 + 当前消息，空格拼接', async () => {
    const c = conv('c1', [userMsg('第一问'), agentMsg('答一'), userMsg('第二问'), agentMsg('答二')]);
    store.getConversation.mockResolvedValue(c);
    agent.reply.mockResolvedValue({ text: '回复' } as AgentReply);

    await svc.sendMessage(USER, 'c1', '构建策略');

    expect(agent.reply).toHaveBeenCalledTimes(1);
    expect(agent.reply).toHaveBeenCalledWith(c, '构建策略', '第一问 第二问 构建策略');
  });

  it('sendMessage：没有历史用户消息时 routeText 即当前消息', async () => {
    const c = conv('c1', [agentMsg('欢迎语')]);
    store.getConversation.mockResolvedValue(c);
    agent.reply.mockResolvedValue({ text: '回复' } as AgentReply);

    await svc.sendMessage(USER, 'c1', '你好');

    expect(agent.reply).toHaveBeenCalledWith(c, '你好', '你好');
  });

  it('sendMessage：落库用户+智能体两条消息、按首条消息命名、返回值与智能体回复一致', async () => {
    store.getConversation.mockResolvedValue(conv('c1', []));
    const card = { type: 'backtest', title: '小盘动量增强', tag: '进攻型', curve: [100], benchCurve: [100], metrics: [] };
    agent.reply.mockResolvedValue({ text: '策略已构建', card } as AgentReply);

    const { userMessage, agentMessage } = await svc.sendMessage(USER, 'c1', '帮我构建策略');

    expect(userMessage).toMatchObject({ role: 'user', bubble: '帮我构建策略' });
    expect(userMessage.time).toMatch(/^\d{2}:\d{2}$/);
    expect(agentMessage).toMatchObject({ role: 'agent', bubble: '策略已构建', card });

    expect(store.appendMessages).toHaveBeenCalledTimes(1);
    const [calledUser, calledId, appended] = store.appendMessages.mock.calls[0];
    expect(calledUser).toBe(USER);
    expect(calledId).toBe('c1');
    expect(appended).toHaveLength(2);
    expect(appended[0]).toMatchObject({ role: 'user', bubble: '帮我构建策略' });
    expect(appended[1]).toMatchObject({ role: 'agent', bubble: '策略已构建', card });

    expect(store.renameConversationFromFirstMessage).toHaveBeenCalledWith(USER, 'c1', '帮我构建策略');
  });

  /* ---------- sendMessageStream：流式编排（过程事件透传，落库语义与 sendMessage 一致） ---------- */

  it('sendMessageStream：会话不存在抛 404，且不调智能体', async () => {
    store.getConversation.mockResolvedValue(undefined);
    await expectApiError(() => svc.sendMessageStream(USER, 'nope', '你好', () => {}), 404, 'NOT_FOUND');
    expect(agent.replyStream).not.toHaveBeenCalled();
  });

  it('sendMessageStream：事件接收端原样透传给 agent.replyStream，编排与 sendMessage 一致', async () => {
    const c = conv('c1', [userMsg('第一问'), agentMsg('答一')]);
    store.getConversation.mockResolvedValue(c);
    const card = { type: 'backtest', title: 'T', tag: 'T', curve: [100], benchCurve: [100], metrics: [] };
    agent.replyStream.mockResolvedValue({ text: '流式回复', card } as AgentReply);
    const seen: unknown[] = [];
    const onProgress = (e: unknown): void => void seen.push(e);

    const { userMessage, agentMessage } = await svc.sendMessageStream(USER, 'c1', '回测一下', onProgress);

    expect(agent.replyStream).toHaveBeenCalledTimes(1);
    expect(agent.replyStream).toHaveBeenCalledWith(c, '回测一下', '第一问 回测一下', onProgress);
    expect(seen).toHaveLength(0); // 事件由智能体引擎产生，编排层只透传不自行发事件
    expect(userMessage).toMatchObject({ role: 'user', bubble: '回测一下' });
    expect(agentMessage).toMatchObject({ role: 'agent', bubble: '流式回复', card });
    expect(store.appendMessages).toHaveBeenCalledTimes(1);
    expect(store.renameConversationFromFirstMessage).toHaveBeenCalledWith(USER, 'c1', '回测一下');
  });
});
