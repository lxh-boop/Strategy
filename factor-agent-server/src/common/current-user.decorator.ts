import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 取当前登录用户 id（JwtAuthGuard 校验通过后写入 req.userId） */
export const UserId = createParamDecorator((_data: unknown, ctx: ExecutionContext): number => {
  return ctx.switchToHttp().getRequest().userId as number;
});
