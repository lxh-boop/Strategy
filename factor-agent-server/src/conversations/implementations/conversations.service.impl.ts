import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { AgentService } from '../../agent/agent.service';
import { nowTime } from '../../core/store.service';
import { UserStoreService } from '../../core/user-store.service';
import { ChatMessage, Conversation } from '../../types';
import { ConversationsService } from '../conversations.service';

/* ==========================================================
   会话业务实现：编排"校验 → 拼 routeText → 调智能体 → 落库 → 命名 → 返回"
   M13：数据经 UserStoreService 按 userId 隔离（userId 来自 JWT，不信任入参）
   ========================================================== */

@Injectable()
export class ConversationsServiceImpl extends ConversationsService {
  constructor(
    private readonly users: UserStoreService,
    private readonly agent: AgentService,
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
  }

  async clear(userId: number, id: string): Promise<Conversation> {
    const conv = await this.users.clearConversation(userId, id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    return conv;
  }

  async getMessages(userId: number, id: string): Promise<ChatMessage[]> {
    const conv = await this.users.getConversation(userId, id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    return conv.messages;
  }

  /** 发送消息：路由上下文取最近 3 条用户消息（含当前，与前端语义一致） */
  async sendMessage(
    userId: number,
    id: string,
    text: string,
  ): Promise<{ userMessage: ChatMessage; agentMessage: ChatMessage }> {
    const conv = await this.users.getConversation(userId, id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);

    const recentUser = conv.messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.bubble);
    const routeText = [...recentUser, text].join(' ');

    const reply = await this.agent.reply(conv, text, routeText);

    const userMessage: ChatMessage = { role: 'user', bubble: text, time: nowTime() };
    const agentMessage: ChatMessage = { role: 'agent', bubble: reply.text, card: reply.card, time: nowTime() };

    await this.users.appendMessages(userId, id, [userMessage, agentMessage]);
    await this.users.renameConversationFromFirstMessage(userId, id, text);

    return { userMessage, agentMessage };
  }
}
