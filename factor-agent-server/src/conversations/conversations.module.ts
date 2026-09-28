import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { ConversationsServiceImpl } from './implementations/conversations.service.impl';

/** 会话模块：接口 token → 实现 */
@Module({
  imports: [AgentModule],
  controllers: [ConversationsController],
  providers: [{ provide: ConversationsService, useClass: ConversationsServiceImpl }],
})
export class ConversationsModule {}
