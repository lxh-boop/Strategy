import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { UserId } from '../common/current-user.decorator';
import { Public } from '../common/public.decorator';
import { AuthService, AuthSuccess, UserPublic } from './auth.service';
import { LoginDto, RegisterDto } from './dto';

/** API-21 ~ API-24（backend-api.md §7.2） */
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** API-21 注册并直接登录（公开；201 返回 token，前端无需再调 login） */
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto): Promise<AuthSuccess> {
    return this.auth.register(dto);
  }

  /** API-22 登录（公开；成功 200，失败统一 401 AUTH_FAILED） */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto): Promise<AuthSuccess> {
    return this.auth.login(dto);
  }

  /** API-23 登出：服务端 token_version +1，已签发 token 全部失效 */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@UserId() userId: number): Promise<void> {
    await this.auth.logout(userId);
  }

  /** API-24 当前登录用户（契约：{ "user": UserPublic }） */
  @Get('me')
  async me(@UserId() userId: number): Promise<{ user: UserPublic }> {
    return { user: await this.auth.me(userId) };
  }
}
