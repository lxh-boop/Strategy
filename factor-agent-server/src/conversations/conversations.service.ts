import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api.exception';
import { AgentService } from '../agent/agent.service';
import { nowTime, StoreService } from '../core/store.service';
import { ChatMessage, Conversation } from '../types';

@Injectable()
export class ConversationsService {
  constructor(
    private readonly store: StoreService,
    private readonly agent: AgentService,
  ) {}

  list(): Conversation[] {
    return this.store.listConversations();
  }

  create(): Conversation {
    return this.store.newConversation();
  }

  remove(id: string): void {
    if (!this.store.deleteConversation(id)) {
      throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    }
  }

  clear(id: string): Conversation {
    const conv = this.store.clearConversation(id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    return conv;
  }

  messages(id: string): ChatMessage[] {
    const conv = this.store.getConversation(id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);
    return conv.messages;
  }

  /** 发送消息：路由上下文取最近 3 条用户消息（含当前，与前端语义一致） */
  async sendMessage(id: string, text: string): Promise<{ userMessage: ChatMessage; agentMessage: ChatMessage }> {
    const conv = this.store.getConversation(id);
    if (!conv) throw new ApiException('NOT_FOUND', 404, `会话不存在: ${id}`);

    const recentUser = conv.messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.bubble);
    const routeText = [...recentUser, text].join(' ');

    const reply = await this.agent.reply(conv, text, routeText);

    const userMessage: ChatMessage = { role: 'user', bubble: text, time: nowTime() };
    const agentMessage: ChatMessage = { role: 'agent', bubble: reply.text, card: reply.card, time: nowTime() };

    this.store.appendMessages(id, [userMessage, agentMessage]);
    this.store.renameConversationFromFirstMessage(id, text);

    return { userMessage, agentMessage };
  }
}
