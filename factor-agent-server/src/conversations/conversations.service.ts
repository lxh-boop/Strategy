import { Injectable } from '@nestjs/common';
import { AgentProgressSink, ChatMessage, Conversation } from '../types';

/* ==========================================================
   会话业务接口（B-INT-01，契约层）—— conversations.controller 的依赖。
   M13 起全部方法带 userId 首参（来自 JWT，实现按用户隔离数据）。
   实现：implementations/conversations.service.impl.ts
   ========================================================== */

/** 发消息的返回：同一次请求的用户消息与智能体回复 */
export interface SendMessageResult {
  userMessage: ChatMessage;
  agentMessage: ChatMessage;
}

@Injectable()
export abstract class ConversationsService {
  abstract list(userId: number): Promise<Conversation[]>;
  abstract create(userId: number): Promise<Conversation>;
  abstract remove(userId: number, id: string): Promise<void>;
  abstract clear(userId: number, id: string): Promise<Conversation>;
  abstract getMessages(userId: number, id: string): Promise<ChatMessage[]>;

  /** 该会话是否有仍在后端执行的轮次（在跑轮次查询）：轮次落库在整轮结束时一次性写入，
   *  执行中的轮次在 list/getMessages 里都不可见——前端刷新后据此恢复"执行中"占位并轮询补齐 */
  abstract getRunStatus(userId: number, id: string): Promise<{ running: boolean }>;

  /** 发消息：返回同一次请求的用户消息与智能体回复 */
  abstract sendMessage(userId: number, id: string, text: string): Promise<SendMessageResult>;

  /** 发消息（流式）：执行过程经 onProgress 推节点级事件（SSE 用），
   *  校验/落库/返回值与 sendMessage 完全一致。 */
  abstract sendMessageStream(
    userId: number,
    id: string,
    text: string,
    onProgress: AgentProgressSink,
  ): Promise<SendMessageResult>;
}
