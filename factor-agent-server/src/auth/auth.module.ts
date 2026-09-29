import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthServiceImpl } from './implementations/auth.service.impl';

/** M13 登录鉴权：JWT 配置读 userJwt.*（.env USER_JWT_*），出口只有 AuthService */
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('userJwt.secret'),
        // expiresIn 类型：jsonwebtoken v9 用 ms 包的 StringValue，这里做一次收窄
        signOptions: { expiresIn: (config.get<string>('userJwt.expiresIn') ?? '7d') as unknown as number },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [{ provide: AuthService, useClass: AuthServiceImpl }],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
