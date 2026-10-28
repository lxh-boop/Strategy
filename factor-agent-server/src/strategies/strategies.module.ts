import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { StrategiesServiceImpl } from './implementations/strategies.service.impl';

/** 策略模块：接口 token → 实现 */
@Module({
  imports: [AgentModule],
  controllers: [StrategiesController],
  providers: [{ provide: StrategiesService, useClass: StrategiesServiceImpl }],
})
export class StrategiesModule {}
