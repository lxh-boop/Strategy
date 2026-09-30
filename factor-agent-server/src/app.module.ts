import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import configuration from './config/configuration';
import { AppController } from './app.controller';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { CoreModule } from './core/core.module';
import { ZhipuModule } from './zhipu/zhipu.module';
import { AgentModule } from './agent/agent.module';
import { AuthModule } from './auth/auth.module';
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
    AuthModule,
    ConversationsModule,
    StrategiesModule,
    MarketModule,
    UserModule,
  ],
  controllers: [AppController],
  // M13：全局 JWT 守卫，默认全部接口需要登录，@Public() 豁免
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
