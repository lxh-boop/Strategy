import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserProfile } from '../types';
import { UpdateSettingDto } from './dto';
import { UserService } from './user.service';

@Controller('api/user')
export class UserController {
  constructor(private readonly users: UserService) {}

  /** 设置项：notify/report 为 toggle，risk 为 single；模型与数据来源由平台统一提供，不在设置项中展示 */
  @Get('profile')
  profile(): UserProfile {
    return this.users.getProfile();
  }

  @Patch('settings')
  updateSetting(@Body() dto: UpdateSettingDto): UserProfile {
    return this.users.updateSetting(dto.key, { on: dto.on, value: dto.value });
  }
}
