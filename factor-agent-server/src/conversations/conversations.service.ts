import { Injectable } from '@nestjs/common';
import { ChatMessage, Conversation } from '../types';

/* ==========================================================
   会话业务接口（B-INT-01，契约层）—— conversations.controller 的依赖。
   实现：implementations/conversations.service.impl.ts
   ========================================================== */

@Injectable()
export abstract class ConversationsService {
  abstract list(): Conversation[];
  abstract create(): Conversation;
  abstract remove(id: string): void;
  abstract clear(id: string): Conversation;
  abstract getMessages(id: string): ChatMessage[];

  /** 发消息：返回同一次请求的用户消息与智能体回复 */
  abstract sendMessage(id: string, text: string): Promise<{ userMessage: ChatMessage; agentMessage: ChatMessage }>;
}
