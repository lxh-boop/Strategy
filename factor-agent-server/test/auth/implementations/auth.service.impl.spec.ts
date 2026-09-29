/* ==========================================================
   B-INT-05 登录鉴权（AuthServiceImpl）单元测试
   存储用真实 MemoryUserStoreService（无需 mock 同款逻辑）、JWT 用测试密钥。
   钉住契约：注册返回 token+user、撞名 409、登录失败统一 401、
   token payload 带 sub/ver、登出后 ver 自增。
   运行：npx jest auth.service.impl
   ========================================================== */
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ApiException } from '../../../src/common/api.exception';
import { MemoryUserStoreService } from '../../../src/core/implementations/memory-user-store.service';
import { UserStoreService } from '../../../src/core/user-store.service';
import { AuthService } from '../../../src/auth/auth.service';
import { AuthServiceImpl } from '../../../src/auth/implementations/auth.service.impl';

const REGISTER = { username: 'zhangsan', password: 'abc12345', nickname: '小张' };

describe('B-INT-05 AuthServiceImpl（登录鉴权）', () => {
  let svc: AuthService;
  let users: MemoryUserStoreService;
  let jwt: JwtService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: AuthService, useClass: AuthServiceImpl },
        MemoryUserStoreService,
        { provide: UserStoreService, useExisting: MemoryUserStoreService },
        { provide: JwtService, useValue: new JwtService({ secret: 'test-secret' }) },
      ],
    }).compile();
    svc = moduleRef.get(AuthService);
    users = moduleRef.get(MemoryUserStoreService);
    jwt = moduleRef.get(JwtService);
  });

  async function expectApiError(fn: () => unknown, status: number, code: string): Promise<ApiException> {
    let caught: unknown;
    try {
      await fn();
      throw new Error(`期望抛出 ApiException(${code})，实际没有抛出`);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ApiException);
    const err = caught as ApiException;
    expect(err.getStatus()).toBe(status);
    expect(err.code).toBe(code);
    return err;
  }

  it('register：bcrypt 哈希入库（不存明文）、返回 token+公开用户信息、token 可验签含 sub/ver', async () => {
    const { token, user } = await svc.register(REGISTER);

    const stored = await users.findByUsername('zhangsan');
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$10\$/);
    expect(stored?.passwordHash).not.toContain('abc12345');

    expect(user).toEqual({ id: expect.any(Number), username: 'zhangsan', nickname: '小张', createdAt: expect.any(String) });
    expect(user).not.toHaveProperty('passwordHash');

    const payload = jwt.verify<{ sub: number; ver: number }>(token);
    expect(payload.sub).toBe(user.id);
    expect(payload.ver).toBe(0);
  });

  it('register：昵称缺省取 username；用户名大小写不敏感撞名抛 409 USERNAME_TAKEN', async () => {
    const { user } = await svc.register({ username: 'lisi', password: 'abc12345' });
    expect(user.nickname).toBe('lisi');

    const err = await expectApiError(() => svc.register({ ...REGISTER, username: 'LISI' }), 409, 'USERNAME_TAKEN');
    expect(err.message).toContain('LISI');
  });

  it('login：正确密码成功并更新 lastLoginAt；密码错误统一 401 AUTH_FAILED（不区分账号/密码错）', async () => {
    const registered = await svc.register(REGISTER);

    const ok = await svc.login({ username: 'zhangsan', password: 'abc12345' });
    expect(ok.user.id).toBe(registered.user.id);
    expect(ok.token).toBeTruthy();

    const stored = await users.findUserById(registered.user.id);
    expect(stored?.lastLoginAt).toBeTruthy();

    const wrongPw = await expectApiError(
      () => svc.login({ username: 'zhangsan', password: 'wrong123' }),
      401,
      'AUTH_FAILED',
    );
    const noUser = await expectApiError(
      () => svc.login({ username: 'nobody', password: 'abc12345' }),
      401,
      'AUTH_FAILED',
    );
    expect(wrongPw.message).toBe(noUser.message);
  });

  it('me：返回当前用户公开信息；登出后 token_version +1（旧 payload.ver 失配）', async () => {
    const { user } = await svc.register(REGISTER);

    expect((await svc.me(user.id)).username).toBe('zhangsan');

    await svc.logout(user.id);
    expect((await users.findUserById(user.id))?.tokenVersion).toBe(1);

    /* 登录重新拿到的 token ver=1（模拟守卫校验旧 token ver=0 的失配） */
    const relogin = await svc.login({ username: 'zhangsan', password: 'abc12345' });
    const old = jwt.verify<{ ver: number }>(relogin.token);
    expect(old.ver).toBe(1);
  });

  it('me：用户不存在抛 401 AUTH_REQUIRED', async () => {
    await expectApiError(() => svc.me(999), 401, 'AUTH_REQUIRED');
  });
});
