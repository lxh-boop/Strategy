import { MaxLength, Matches, IsOptional, IsString } from 'class-validator';

/** 用户名：3~24 位字母/数字/下划线（与契约 §7.2、users.username VARCHAR(24) 一致） */
export const USERNAME_RE = /^[A-Za-z0-9_]{3,24}$/;

/** 密码：6~64 位可打印 ASCII（bcrypt 只看前 72 字节，限 ASCII 防多字节截断） */
export const PASSWORD_RE = /^[\x20-\x7E]{6,64}$/;

export class RegisterDto {
  @Matches(USERNAME_RE, { message: '用户名须为 3~24 位字母/数字/下划线' })
  username: string;

  @Matches(PASSWORD_RE, { message: '密码须为 6~64 位可打印 ASCII 字符' })
  password: string;

  /** 昵称可选，缺省取 username */
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '昵称不能超过 40 字' })
  nickname?: string;
}

export class LoginDto {
  @Matches(USERNAME_RE, { message: '用户名须为 3~24 位字母/数字/下划线' })
  username: string;

  /** 登录不做格式强校验：格式不符与密码错误统一走 401 AUTH_FAILED，不暴露规则细节 */
  @IsString()
  password: string;
}
