import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserServiceImpl } from './implementations/user.service.impl';

/** 用户模块：接口 token → 实现 */
@Module({
  controllers: [UserController],
  providers: [{ provide: UserService, useClass: UserServiceImpl }],
})
export class UserModule {}
