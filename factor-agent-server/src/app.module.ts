import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { AppController } from './app.controller';
import { CoreModule } from './core/core.module';
import { ZhipuModule } from './zhipu/zhipu.module';
import { AgentModule } from './agent/agent.module';
import { ConversationsModule } from './conversations/conversations.module';
import { StrategiesModule } from './strategies/strategies.module';
import { MarketModule } from './market/market.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    CoreModule,
    ZhipuModule,
    AgentModule,
    ConversationsModule,
    StrategiesModule,
    MarketModule,
    UserModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
