import { Injectable } from '@nestjs/common';
import { ChatMessage, Conversation, Strategy } from '../types';

/* ==========================================================
   用户库存储接口（SVC-D23，契约层）—— M13 登录鉴权与多用户。
   与 StoreService 的区别：一切用户维度数据带 userId 首参（数据隔离靠它，
   userId 只能来自 JWT 校验结果，绝不信任请求入参）；
   因子库/回测参数/股票池等公共配置数据仍走 StoreService（SVC-D14~D16）。
   实现：implementations/mysql-user-store.service.ts（USER_DB_* 已配置时）
        implementations/memory-user-store.service.ts（未配置时开发兜底）
   表结构：docs/db/user-tables.sql（alphasage_user 库）
   ========================================================== */

/** 用户表行（含敏感字段 passwordHash / tokenVersion，任何接口不得直接返回） */
export interface UserRow {
  id: number;
  username: string;
  passwordHash: string;
  nickname: string;
  tokenVersion: number;
  /** 'YYYY-MM-DD HH:MM:SS'（dateStrings 口径），注册即视为首次登录 */
  lastLoginAt: string | null;
  createdAt: string;
}

/** 用户设置行（口径同 API-17/18；risk 存中文显示值，缺省 '稳健型'） */
export interface UserSettingsRow {
  notify: boolean;
  report: boolean;
  risk: string;
}

export type SettingKey = 'notify' | 'report' | 'risk';

@Injectable()
export abstract class UserStoreService {
  /* ----- 账号（B-INT-05 专用） ----- */
  /** 创建用户并初始化默认设置；用户名撞唯一键由实现抛 409 USERNAME_TAKEN */
  abstract createUser(input: { username: string; passwordHash: string; nickname: string }): Promise<UserRow>;
  /** 大小写不敏感查找（utf8mb4_unicode_ci 口径），登录用 */
  abstract findByUsername(username: string): Promise<UserRow | undefined>;
  abstract findUserById(id: number): Promise<UserRow | undefined>;
  /** 登出：token_version +1，旧 JWT 立即全部失效 */
  abstract bumpTokenVersion(id: number): Promise<void>;
  /** 登录成功更新最近登录时间 */
  abstract touchLastLogin(id: number): Promise<void>;

  /* ----- 策略（按用户隔离，方法集镜像 SVC-D01~D04） ----- */
  abstract listStrategies(userId: number): Promise<Strategy[]>;
  abstract getStrategy(userId: number, id: string): Promise<Strategy | undefined>;
  abstract saveStrategy(userId: number, strategy: Strategy): Promise<void>;
  abstract deleteStrategy(userId: number, id: string): Promise<boolean>;

  /* ----- 会话（按用户隔离，方法集镜像 SVC-D05~D11） ----- */
  abstract listConversations(userId: number): Promise<Conversation[]>;
  abstract getConversation(userId: number, id: string): Promise<Conversation | undefined>;
  abstract newConversation(userId: number): Promise<Conversation>;
  abstract deleteConversation(userId: number, id: string): Promise<boolean>;
  abstract clearConversation(userId: number, id: string): Promise<Conversation | undefined>;
  abstract appendMessages(userId: number, id: string, msgs: ChatMessage[]): Promise<Conversation | undefined>;
  abstract renameConversationFromFirstMessage(userId: number, id: string, text: string): Promise<void>;

  /* ----- 用户设置（按用户隔离，方法集镜像 SVC-D17~D18） ----- */
  abstract getSettings(userId: number): Promise<UserSettingsRow>;
  abstract updateSetting(userId: number, key: SettingKey, patch: { on?: boolean; value?: string }): Promise<void>;
}
