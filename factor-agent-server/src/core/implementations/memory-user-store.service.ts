import { Injectable } from '@nestjs/common';
import {
  SettingKey,
  UserRow,
  UserSettingsRow,
  UserStoreService,
  WELCOME_TEXT,
} from '../user-store.service';
import { nowTime } from '../../common/time';
import { ChatMessage, Conversation, Strategy } from '../../types';

/* ==========================================================
   用户库内存实现：.env 未配置 USER_DB_HOST 时的开发兜底（数据不落盘、
   重启即失）。方法语义与 MysqlUserStoreService 一一对应，便于本地无库联调。
   ========================================================== */

/** 'YYYY-MM-DD HH:MM:SS'（与 MySQL dateStrings 口径一致） */
function fmtNow(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

@Injectable()
export class MemoryUserStoreService extends UserStoreService {
  private nextId = 1;
  private readonly users = new Map<number, UserRow>();
  private readonly settings = new Map<number, UserSettingsRow>();
  private readonly strategies = new Map<string, Strategy>();
  private readonly conversations = new Map<string, Conversation>();

  private key(userId: number, id: string): string {
    return `${userId}|${id}`;
  }

  /* ----- 账号 ----- */
  async createUser(input: { username: string; passwordHash: string; nickname: string }): Promise<UserRow> {
    const dup = await this.findByUsername(input.username);
    if (dup) throw Object.assign(new Error('ER_DUP_ENTRY'), { code: 'ER_DUP_ENTRY' });
    const now = fmtNow();
    const user: UserRow = {
      id: this.nextId++,
      username: input.username,
      passwordHash: input.passwordHash,
      nickname: input.nickname,
      tokenVersion: 0,
      lastLoginAt: now,
      createdAt: now,
    };
    this.users.set(user.id, user);
    this.settings.set(user.id, { notify: true, report: true, risk: '稳健型' });
    return user;
  }

  async findByUsername(username: string): Promise<UserRow | undefined> {
    // 与 MySQL utf8mb4_unicode_ci 同口径：大小写不敏感
    const lower = username.toLowerCase();
    return [...this.users.values()].find((u) => u.username.toLowerCase() === lower);
  }

  async findUserById(id: number): Promise<UserRow | undefined> {
    return this.users.get(id);
  }

  async bumpTokenVersion(id: number): Promise<void> {
    const user = this.users.get(id);
    if (user) user.tokenVersion += 1;
  }

  async touchLastLogin(id: number): Promise<void> {
    const user = this.users.get(id);
    if (user) user.lastLoginAt = fmtNow();
  }

  /* ----- 策略 ----- */
  async listStrategies(userId: number): Promise<Strategy[]> {
    return [...this.strategies.entries()].filter(([k]) => k.startsWith(`${userId}|`)).map(([, s]) => s);
  }

  async getStrategy(userId: number, id: string): Promise<Strategy | undefined> {
    return this.strategies.get(this.key(userId, id));
  }

  async saveStrategy(userId: number, strategy: Strategy): Promise<void> {
    this.strategies.set(this.key(userId, strategy.id), strategy);
  }

  async deleteStrategy(userId: number, id: string): Promise<boolean> {
    return this.strategies.delete(this.key(userId, id));
  }

  /* ----- 会话 ----- */
  async listConversations(userId: number): Promise<Conversation[]> {
    return [...this.conversations.entries()]
      .filter(([k]) => k.startsWith(`${userId}|`))
      .map(([, c]) => c)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getConversation(userId: number, id: string): Promise<Conversation | undefined> {
    return this.conversations.get(this.key(userId, id));
  }

  async newConversation(userId: number): Promise<Conversation> {
    const conv: Conversation = {
      id: 'c' + Date.now() + Math.random().toString(36).slice(2, 6),
      title: '新对话',
      updatedAt: Date.now(),
      messages: [{ role: 'agent', bubble: WELCOME_TEXT, time: nowTime() }],
    };
    this.conversations.set(this.key(userId, conv.id), conv);
    return conv;
  }

  async deleteConversation(userId: number, id: string): Promise<boolean> {
    return this.conversations.delete(this.key(userId, id));
  }

  async clearConversation(userId: number, id: string): Promise<Conversation | undefined> {
    const conv = this.conversations.get(this.key(userId, id));
    if (!conv) return undefined;
    conv.title = '新对话';
    conv.updatedAt = Date.now();
    conv.messages = [{ role: 'agent', bubble: WELCOME_TEXT, time: nowTime() }];
    return conv;
  }

  async appendMessages(userId: number, id: string, msgs: ChatMessage[]): Promise<Conversation | undefined> {
    const conv = this.conversations.get(this.key(userId, id));
    if (!conv) return undefined;
    conv.messages.push(...msgs);
    conv.updatedAt = Date.now();
    return conv;
  }

  async renameConversationFromFirstMessage(userId: number, id: string, text: string): Promise<void> {
    const conv = this.conversations.get(this.key(userId, id));
    if (!conv || conv.title !== '新对话') return;
    conv.title = text.length > 16 ? text.slice(0, 16) + '…' : text;
  }

  /* ----- 用户设置 ----- */
  async getSettings(userId: number): Promise<UserSettingsRow> {
    let s = this.settings.get(userId);
    if (!s) {
      s = { notify: true, report: true, risk: '稳健型' };
      this.settings.set(userId, s);
    }
    return s;
  }

  async updateSetting(userId: number, key: SettingKey, patch: { on?: boolean; value?: string }): Promise<void> {
    const s = await this.getSettings(userId);
    if (key === 'risk') s.risk = patch.value ?? s.risk;
    else if (patch.on !== undefined) s[key] = patch.on;
  }
}
