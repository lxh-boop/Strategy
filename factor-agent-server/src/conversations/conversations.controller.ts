import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { Conversation, ChatMessage } from '../types';
import { ConversationsService } from './conversations.service';
import { SendMessageDto } from './dto';

@Controller('api/conversations')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  list(): Conversation[] {
    return this.conversations.list();
  }

  @Post()
  create(): Conversation {
    return this.conversations.create();
  }

  /** 注意路由顺序：具体路径在前，:id 参数路由在后 */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.conversations.remove(id);
  }

  @Post(':id/clear')
  clear(@Param('id') id: string): Conversation {
    return this.conversations.clear(id);
  }

  @Get(':id/messages')
  messages(@Param('id') id: string): ChatMessage[] {
    return this.conversations.messages(id);
  }

  @Post(':id/messages')
  async send(@Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.conversations.sendMessage(id, dto.text);
  }
}
