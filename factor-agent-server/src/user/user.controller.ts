import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserProfile } from '../types';
import { ApiException } from '../common/api.exception';
import { StoreService } from '../core/store.service';
import { UpdateSettingDto } from './dto';

@Controller('api/user')
export class UserController {
  constructor(private readonly store: StoreService) {}

  /** 模型（智谱 GLM）与数据来源在 settings 中为 readonly 展示项，用户不可配置 */
  @Get('profile')
  profile(): UserProfile {
    return this.store.getProfile();
  }

  @Patch('settings')
  updateSetting(@Body() dto: UpdateSettingDto): UserProfile {
    const setting = this.store.updateSetting(dto.key, { on: dto.on, value: dto.value });
    if (!setting) {
      throw new ApiException('NOT_FOUND', 404, `未知的设置项: ${dto.key}`);
    }
    return this.store.getProfile();
  }
}
