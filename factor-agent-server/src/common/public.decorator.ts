import { SetMetadata } from '@nestjs/common';

/** 标记公开接口（免 JWT）：API-01/14/15/16/21/22，其余接口默认全部需要登录 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
