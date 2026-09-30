import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compareSync, hashSync } from 'bcryptjs';
import { ApiException } from '../../common/api.exception';
import { UserRow, UserStoreService } from '../../core/user-store.service';
import { AuthService, AuthSuccess, UserPublic } from '../auth.service';
import { LoginDto, RegisterDto } from '../dto';

/* ==========================================================
   登录鉴权实现：bcrypt 哈希（cost 10）+ JWT（HS256，payload {sub, ver}）。
   - 密码哈希永不回传；登录失败统一 401 AUTH_FAILED 不区分账号/密码错；
   - token 里带 token_version（ver），登出时服务端 ver+1 使旧 token 全失效；
   - 用户名唯一键由 utf8mb4_unicode_ci 保证大小写不敏感，并发注册兜底
     ER_DUP_ENTRY → 409（docs/db/user-tables.sql 表注释同款约定）。
   ========================================================== */

@Injectable()
export class AuthServiceImpl extends AuthService {
  private readonly logger = new Logger('AuthService');

  constructor(
    private readonly users: UserStoreService,
    private readonly jwt: JwtService,
  ) {
    super();
  }

  async register(dto: RegisterDto): Promise<AuthSuccess> {
    const exists = await this.users.findByUsername(dto.username);
    if (exists) {
      throw new ApiException('USERNAME_TAKEN', 409, `用户名已被占用: ${dto.username}`);
    }
    const passwordHash = hashSync(dto.password, 10);
    const user = await this.users.createUser({
      username: dto.username,
      passwordHash,
      nickname: dto.nickname?.trim() || dto.username,
    });
    this.logger.log(`新用户注册: ${user.username} (id=${user.id})`);
    return { token: await this.sign(user), user: toPublic(user) };
  }

  async login(dto: LoginDto): Promise<AuthSuccess> {
    const user = await this.users.findByUsername(dto.username);
    if (!user || !compareSync(dto.password, user.passwordHash)) {
      throw new ApiException('AUTH_FAILED', 401, '用户名或密码错误');
    }
    await this.users.touchLastLogin(user.id);
    return { token: await this.sign(user), user: toPublic(user) };
  }

  async logout(userId: number): Promise<void> {
    await this.users.bumpTokenVersion(userId);
    this.logger.log(`用户登出: id=${userId}`);
  }

  async me(userId: number): Promise<UserPublic> {
    const user = await this.users.findUserById(userId);
    if (!user) throw new ApiException('AUTH_REQUIRED', 401, '用户不存在或已被删除');
    return toPublic(user);
  }

  private async sign(user: UserRow): Promise<string> {
    return this.jwt.signAsync({ sub: user.id, ver: user.tokenVersion });
  }
}

function toPublic(user: UserRow): UserPublic {
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    createdAt: new Date(String(user.createdAt).replace(' ', 'T')).toISOString(),
  };
}
