import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserProfile } from '../types';
import { UpdateSettingDto } from './dto';
import { UserService } from './user.service';

@Controller('api/user')
export class UserController {
  constructor(private readonly users: UserService) {}

  /** 模型（智谱 GLM）与数据来源在 settings 中为 readonly 展示项，用户不可配置 */
  @Get('profile')
  profile(): UserProfile {
    return this.users.getProfile();
  }

  @Patch('settings')
  updateSetting(@Body() dto: UpdateSettingDto): UserProfile {
    return this.users.updateSetting(dto.key, { on: dto.on, value: dto.value });
  }
}
