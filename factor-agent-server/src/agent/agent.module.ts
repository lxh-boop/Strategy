import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { LangGraphAgentService } from './implementations/langgraph-agent.service';

/** 智能体引擎：接口 token → 实现（换引擎只改 useClass，业务层零改动） */
@Module({
  providers: [{ provide: AgentService, useClass: LangGraphAgentService }],
  exports: [AgentService],
})
export class AgentModule {}
