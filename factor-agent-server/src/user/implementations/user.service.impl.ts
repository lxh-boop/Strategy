import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/api.exception';
import { StoreService } from '../../core/store.service';
import { UserProfile } from '../../types';
import { UserService } from '../user.service';

/* ==========================================================
   用户业务实现：个人资料读取 + 设置项更新（白名单校验在 DTO，业务层兜底 404）
   ========================================================== */

@Injectable()
export class UserServiceImpl extends UserService {
  constructor(private readonly store: StoreService) {
    super();
  }

  getProfile(): UserProfile {
    return this.store.getProfile();
  }

  updateSetting(key: string, payload: { on?: boolean; value?: string }): UserProfile {
    const setting = this.store.updateSetting(key, payload);
    if (!setting) {
      throw new ApiException('NOT_FOUND', 404, `未知的设置项: ${key}`);
    }
    return this.store.getProfile();
  }
}
