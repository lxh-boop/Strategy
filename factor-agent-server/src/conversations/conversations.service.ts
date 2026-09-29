import { Injectable } from '@nestjs/common';
import { ChatMessage, Conversation } from '../types';

/* ==========================================================
   会话业务接口（B-INT-01，契约层）—— conversations.controller 的依赖。
   M13 起全部方法带 userId 首参（来自 JWT，实现按用户隔离数据）。
   实现：implementations/conversations.service.impl.ts
   ========================================================== */

@Injectable()
export abstract class ConversationsService {
  abstract list(userId: number): Promise<Conversation[]>;
  abstract create(userId: number): Promise<Conversation>;
  abstract remove(userId: number, id: string): Promise<void>;
  abstract clear(userId: number, id: string): Promise<Conversation>;
  abstract getMessages(userId: number, id: string): Promise<ChatMessage[]>;

  /** 发消息：返回同一次请求的用户消息与智能体回复 */
  abstract sendMessage(
    userId: number,
    id: string,
    text: string,
  ): Promise<{ userMessage: ChatMessage; agentMessage: ChatMessage }>;
}
