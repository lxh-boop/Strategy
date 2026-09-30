import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ChatMessage, Conversation } from '../types';
import { UserId } from '../common/current-user.decorator';
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

  @Post(':id/messages')
  async send(@UserId() userId: number, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.conversations.sendMessage(userId, id, dto.text);
  }
}
