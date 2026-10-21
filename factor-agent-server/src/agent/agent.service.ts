import { Injectable } from '@nestjs/common';
import { AgentProgressSink, AgentReply, Conversation } from '../types';

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

  /**
   * 该会话是否有一轮仍在后端执行中（消息级并发闸的查询面）。
   * 轮次落库在整轮结束时一次性写入，执行中的轮次在任何历史接口里都看不到——
   * 前端刷新后据此恢复"执行中"占位并轮询补齐结果。
   */
  abstract hasInflightRun(conversationId: string): boolean;

  /**
   * reply 的流式形态：执行过程经 onProgress 推送节点级事件
   * （看表/看字段/读数/回测的 tool_call 与 tool_result，见 AgentProgressEvent），
   * 返回值与 reply() 完全一致；事件只是附加推送，最终结果以返回值为准。
   * 默认实现不产生任何事件、直接委托 reply()——实现方可选择只覆写 reply()。
   */
  replyStream(
    conversation: Conversation,
    userText: string,
    routeText: string,
    onProgress: AgentProgressSink,
  ): Promise<AgentReply> {
    void onProgress;
    return this.reply(conversation, userText, routeText);
  }
}
