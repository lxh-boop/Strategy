import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { ChatMessage, Conversation } from '../types';
import { UserId } from '../common/current-user.decorator';
import { ApiException } from '../common/api.exception';
import { ConversationsService } from './conversations.service';
import { SendMessageDto } from './dto';

/** API-02 ~ API-07（M13 起需 Bearer，数据按 token 用户隔离） */
@Controller('api/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  async list(@UserId() userId: number): Promise<Conversation[]> {
    return this.conversations.list(userId);
  }

  @Post()
  async create(@UserId() userId: number): Promise<Conversation> {
    return this.conversations.create(userId);
  }

  /** 注意路由顺序：具体路径在前，:id 参数路由在后 */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@UserId() userId: number, @Param('id') id: string): Promise<void> {
    await this.conversations.remove(userId, id);
  }

  @Post(':id/clear')
  async clear(@UserId() userId: number, @Param('id') id: string): Promise<Conversation> {
    return this.conversations.clear(userId, id);
  }

  @Get(':id/messages')
  async messages(@UserId() userId: number, @Param('id') id: string): Promise<ChatMessage[]> {
    return this.conversations.getMessages(userId, id);
  }

  /** 在跑轮次查询：该会话是否有仍在后端执行的轮次。轮次落库在整轮结束时一次性写入，
   *  执行中的轮次在 list/messages 里不可见——刷新后前端据此恢复"执行中"占位并轮询补齐 */
  @Get(':id/run')
  async runStatus(@UserId() userId: number, @Param('id') id: string): Promise<{ running: boolean }> {
    return this.conversations.getRunStatus(userId, id);
  }

  @Post(':id/messages')
  async send(@UserId() userId: number, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.conversations.sendMessage(userId, id, dto.text);
  }

  /** 发消息（流式）：过程事件以 text/event-stream 推送（节点级，非推理流式）。
   *  事件序列 = start → tool_call/tool_result* → confirm_pending?（确认门挂起时，
   *  先于 final 到达）→ final（携带与 POST /:id/messages 完全相同的响应体）→ 连接结束；
   *  失败以 error 事件收尾。
   *  HTTP 恒 200（开流后状态码不可改），错误一律走 error 事件；
   *  EventSource 不支持 POST，前端用 fetch 读流；中途断开不影响最终落库。 */
  @Post(':id/chat/stream')
  async sendStream(
    @UserId() userId: number,
    @Param('id') id: string,
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 关闭反向代理缓冲，事件即时到达
    res.flushHeaders();
    const write = (event: unknown): void => {
      try {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        /* 客户端已断开：静默丢弃后续事件 */
      }
    };
    try {
      const result = await this.conversations.sendMessageStream(userId, id, dto.text, write);
      write({ type: 'final', ...result });
    } catch (error) {
      const code = error instanceof ApiException ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof ApiException ? error.message : '服务异常，请稍后重试';
      write({ type: 'error', code, message });
    } finally {
      res.end();
    }
  }
}
