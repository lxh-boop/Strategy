import { Injectable } from '@nestjs/common';
import { UserProfile } from '../types';

/* ==========================================================
   用户业务接口（B-INT-04，契约层）—— user.controller 的依赖。
   M13 起全部方法带 userId 首参（来自 JWT，实现按用户隔离数据）。
   实现：implementations/user.service.impl.ts
   ========================================================== */

@Injectable()
export abstract class UserService {
  /** 用户信息 + 因子偏好 + 设置项（模型/数据来源为 readonly 展示） */
  abstract getProfile(userId: number): Promise<UserProfile>;

  /** 更新设置项（白名单外 key 由实现抛 404） */
  abstract updateSetting(userId: number, key: string, payload: { on?: boolean; value?: string }): Promise<UserProfile>;
}
