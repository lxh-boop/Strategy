import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserProfile } from '../types';
import { UserId } from '../common/current-user.decorator';
import { UpdateSettingDto } from './dto';
import { UserService } from './user.service';

/** API-17/18（M13 起需 Bearer，按 token 用户隔离） */
@Controller('api/user')
export class UserController {
  constructor(private readonly users: UserService) {}

  /** 设置项：notify/report 为 toggle，risk 为 single；模型与数据来源由平台统一提供，不在设置项中展示 */
  @Get('profile')
  async profile(@UserId() userId: number): Promise<UserProfile> {
    return this.users.getProfile(userId);
  }

  @Patch('settings')
  async updateSetting(
    @UserId() userId: number,
    @Body() dto: UpdateSettingDto,
  ): Promise<UserProfile> {
    return this.users.updateSetting(userId, dto.key, { on: dto.on, value: dto.value });
  }
}
