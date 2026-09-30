import { Injectable } from '@nestjs/common';
import { AuthSuccess, UserPublic } from '../types';
import { LoginDto, RegisterDto } from './dto';

/* ==========================================================
   登录鉴权业务接口（B-INT-05，契约层）—— auth.controller 的依赖。
   实现：implementations/auth.service.impl.ts（bcrypt + JWT）
   UserPublic / AuthSuccess 定义在 ../types（与前端共享），此处引用。
   ========================================================== */

export type { AuthSuccess, UserPublic };

@Injectable()
export abstract class AuthService {
  /** 注册并直接登录；用户名重复抛 409 USERNAME_TAKEN */
  abstract register(dto: RegisterDto): Promise<AuthSuccess>;

  /** 登录；账号不存在或密码错误统一抛 401 AUTH_FAILED（不区分，防撞库） */
  abstract login(dto: LoginDto): Promise<AuthSuccess>;

  /** 登出：token_version +1 使已签发 token 全部失效 */
  abstract logout(userId: number): Promise<void>;

  abstract me(userId: number): Promise<UserPublic>;
}
