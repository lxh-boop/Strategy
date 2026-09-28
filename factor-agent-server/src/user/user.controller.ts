import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserProfile } from '../types';
import { ApiException } from '../common/api.exception';
import { StoreService } from '../core/store.service';
import { CreateApiKeyDto, UpdateSettingDto } from './dto';

@Controller('api/user')
export class UserController {
  constructor(private readonly store: StoreService) {}

  /** 出参中 apiKeys 已脱敏，完整密钥仅在创建时提交一次 */
  @Get('profile')
  profile(): UserProfile {
    return this.store.getProfile();
  }

  @Patch('settings')
  updateSetting(@Body() dto: UpdateSettingDto): UserProfile {
    const value = dto.values !== undefined ? dto.values.join(' + ') : dto.value;
    const setting = this.store.updateSetting(dto.key, { on: dto.on, value });
    if (!setting) {
      throw new ApiException('NOT_FOUND', 404, `未知的设置项: ${dto.key}`);
    }
    return this.store.getProfile();
  }

  @Post('apikeys')
  addApiKey(@Body() dto: CreateApiKeyDto): UserProfile {
    const profile = this.store.addApiKey(dto.name.trim(), dto.key.trim());
    if (!profile) {
      throw new ApiException('DUPLICATE_NAME', 409, `已存在同名密钥: ${dto.name}`);
    }
    return profile;
  }

  @Delete('apikeys/:name')
  removeApiKey(@Param('name') name: string): UserProfile {
    const profile = this.store.removeApiKey(decodeURIComponent(name));
    if (!profile) {
      throw new ApiException('NOT_FOUND', 404, `密钥不存在: ${name}`);
    }
    return profile;
  }
}
