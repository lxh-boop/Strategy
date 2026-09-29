import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from './api.exception';
import { IS_PUBLIC_KEY } from './public.decorator';
import { UserStoreService } from '../core/user-store.service';

/* ==========================================================
   全局 JWT 守卫（M13）：默认所有路由需要登录，@Public() 豁免
   （API-01/14/15/16/21/22）。校验两道：
   ① JWT 签名与有效期；② payload.ver 与库中 token_version 一致
   （登出后旧 token 即使未过期也立即失效）。
   通过后把 userId 写入 req.userId，业务层经 @UserId() 取用。
   ========================================================== */

interface JwtPayload {
  sub: number;
  ver: number;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly users: UserStoreService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    if (!header.startsWith('Bearer ')) {
      throw new ApiException('AUTH_REQUIRED', 401, '未登录：请在 Authorization 头携带 Bearer token');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(header.slice('Bearer '.length).trim());
    } catch {
      throw new ApiException('AUTH_REQUIRED', 401, 'token 无效或已过期，请重新登录');
    }

    const user = await this.users.findUserById(Number(payload.sub));
    if (!user || user.tokenVersion !== payload.ver) {
      throw new ApiException('AUTH_REQUIRED', 401, '登录状态已失效，请重新登录');
    }

    req.userId = user.id;
    return true;
  }
}
