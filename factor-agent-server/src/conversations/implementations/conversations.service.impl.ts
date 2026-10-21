import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { AgentService } from '../../agent/agent.service';
import { nowTime } from '../../common/time';
import { MemoryStoreService } from '../../core/memory-store.service';
import { UserStoreService } from '../../core/user-store.service';
import { AgentProgressSink, ChatMessage, Conversation } from '../../types';
import { ConversationsService, SendMessageResult } from '../conversations.service';

/* ==========================================================
   会话业务实现：编排"校验 → 拼 routeText → 调智能体 → 落库 → 命名 → 返回"
   M13：数据经 UserStoreService 按 userId 隔离（userId 来自 JWT，不信任入参）
   sendMessage 与 sendMessageStream 共享 prepare/persist 两段编排，
   唯一差别是调 agent.reply 还是 agent.replyStream（后者附带过程事件）。
   ========================================================== */

@Injectable()
export class ConversationsServiceImpl extends ConversationsService {
  constructor(
    private readonly users: UserStoreService,
    private readonly agent: AgentService,
    private readonly memories: MemoryStoreService,
  ) {
    super();
  }

  async list(userId: number): Promise<Conversation[]> {
    return this.users.listConversations(userId);
  }

  async create(userId: number): Promise<Conversation> {
    return this.users.newConversation(userId);
  }

  async remove(userId: number, id: string): Promise<void> {
    if (!(await this.users.deleteConversation(userId, id))) {
      throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    }
    // 会话滚动摘要随会话删除清理（ADR-0007）；长期记忆条目是跨对话本体，不随会话删
    await this.memories.clearSummary(userId, id);
  }

  async clear(userId: number, id: string): Promise<Conversation> {
    const conv = await this.users.clearConversation(userId, id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    // 消息已清空，摘要必须同步清（否则摘要提及已删消息，注入与现实脱节）——ADR-0007
    await this.memories.clearSummary(userId, id);
    return conv;
  }

  async getMessages(userId: number, id: string): Promise<ChatMessage[]> {
    const conv = await this.users.getConversation(userId, id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    return conv.messages;
  }

  /** 在跑轮次查询：归属校验同 getMessages，运行态来自智能体的消息级并发闸（进程内存） */
  async getRunStatus(userId: number, id: string): Promise<{ running: boolean }> {
    const conv = await this.users.getConversation(userId, id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    return { running: this.agent.hasInflightRun(id) };
  }

  /** 发送消息：路由上下文取最近 3 条用户消息（含当前，与前端语义一致） */
  async sendMessage(userId: number, id: string, text: string): Promise<SendMessageResult> {
    const { conv, routeText } = await this.prepare(userId, id, text);
    const reply = await this.agent.reply(conv, text, routeText);
    return this.persist(userId, id, text, reply);
  }

  /** 发送消息（流式）：编排同 sendMessage，智能体换成 replyStream 推过程事件 */
  async sendMessageStream(
    userId: number,
    id: string,
    text: string,
    onProgress: AgentProgressSink,
  ): Promise<SendMessageResult> {
    const { conv, routeText } = await this.prepare(userId, id, text);
    const reply = await this.agent.replyStream(conv, text, routeText, onProgress);
    return this.persist(userId, id, text, reply);
  }

  /** 编排前半：会话校验 + 路由上下文（最近 2 条用户消息 + 当前消息拼接）。
   *  顺手把 JWT userId 附加到会话对象——智能体的长期记忆/摘要目录按它隔离（ADR-0007） */
  private async prepare(userId: number, id: string, text: string): Promise<{ conv: Conversation; routeText: string }> {
    const conv = await this.users.getConversation(userId, id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    const recentUser = conv.messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.bubble);
    return { conv: { ...conv, userId }, routeText: [...recentUser, text].join(' ') };
  }

  /** 编排后半：落库用户/智能体消息 + 按首条消息命名会话 */
  private async persist(userId: number, id: string, text: string, reply: { text: string; card?: ChatMessage['card'] }): Promise<SendMessageResult> {
    const userMessage: ChatMessage = { role: 'user', bubble: text, time: nowTime() };
    const agentMessage: ChatMessage = { role: 'agent', bubble: reply.text, card: reply.card, time: nowTime() };
    await this.users.appendMessages(userId, id, [userMessage, agentMessage]);
    await this.users.renameConversationFromFirstMessage(userId, id, text);
    return { userMessage, agentMessage };
  }
}
