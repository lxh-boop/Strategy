import { Injectable } from '@nestjs/common';
import { AgentReply, Conversation } from '../types';

/* ==========================================================
   智能体引擎接口（契约层）—— 业务层（会话模块）唯一可见的能力：
   运行一轮对话，得到回复文案与可选的结构化卡片。
   实现：implementations/langgraph-agent.service.ts
   （LangGraph 工具循环 + 智谱 GLM tool-calling）
   ========================================================== */

@Injectable()
export abstract class AgentService {
  /**
   * 运行一轮对话。
   * @param conversation 完整会话对象（含 messages，实现方自取最近若干条做上下文）
   * @param userText     当前这条用户消息
   * @param routeText    最近 2 条用户消息 + 当前消息的拼接（规则分支消歧用）
   * @returns text 为回复文案（GLM 失败时=失败原因，且无卡片）；card 可选 report/backtest/stocks
   */
  abstract reply(conversation: Conversation, userText: string, routeText: string): Promise<AgentReply>;
}
