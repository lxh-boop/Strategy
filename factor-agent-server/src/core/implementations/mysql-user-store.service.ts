import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool, Pool, PoolConnection } from 'mysql2/promise';
import { ApiException } from '../../common/api.exception';
import {
  SettingKey,
  UserRow,
  UserSettingsRow,
  UserStoreService,
} from '../user-store.service';
import { nowTime, WELCOME_TEXT } from '../store.service';
import { AgentCard, ChatMessage, Conversation, Strategy } from '../../types';

/* ==========================================================
   用户库 MySQL 实现（M13 / SVC-D23）：alphasage_user 库，独立连接池
   USER_DB_*（与只读因子库 MYSQL_* 分开）。表结构 docs/db/user-tables.sql。
   - 一切查询带 user_id 条件，数据隔离在 SQL 层兜底；
   - 值全部参数化；发消息/清空会话等多行写入放同一事务；
   - 会话列表按 updated_at 倒序（ON UPDATE 不会因消息写入触发，
     appendMessages 必须显式 UPDATE conversations.updated_at）；
   - 消息顺序按自增 id（ORDER BY id）。
   ========================================================== */

interface UserDbRow {
  id: number;
  username: string;
  password_hash: string;
  nickname: string;
  token_version: number;
  last_login_at: string | null;
  created_at: string;
}

interface StrategyDbRow {
  id: string;
  name: string;
  universe: string;
  rebalance: string;
  benchmark: string;
  factors: unknown;
  status: string;
  metrics: unknown;
  curve: unknown;
  bench_curve: unknown;
  holdings: unknown;
  updated_at: string;
}

interface ConversationDbRow {
  id: string;
  title: string;
  updated_at: string;
}

interface MessageDbRow {
  id: number;
  role: string;
  bubble: string;
  card: unknown;
  time: string;
}

@Injectable()
export class MysqlUserStoreService extends UserStoreService {
  private readonly logger = new Logger('MysqlUserStore');
  private pool: Pool | null = null;

  constructor(private readonly config: ConfigService) {
    super();
  }

  /* ----- 账号 ----- */

  async createUser(input: { username: string; passwordHash: string; nickname: string }): Promise<UserRow> {
    try {
      const result = await this.withConn(async (conn) => {
        const [r] = await conn.execute(
          'INSERT INTO users (username, password_hash, nickname, last_login_at) VALUES (?, ?, ?, NOW())',
          [input.username, input.passwordHash, input.nickname],
        );
        const id = Number((r as { insertId: number }).insertId);
        await conn.execute('INSERT INTO user_settings (user_id) VALUES (?)', [id]);
        return id;
      });
      const user = await this.findUserById(result);
      if (!user) throw new Error(`用户创建后读取失败: id=${result}`);
      this.logger.log(`注册用户: ${user.username} (id=${user.id})`);
      return user;
    } catch (error) {
      if (this.isDupEntry(error)) {
        throw new ApiException('USERNAME_TAKEN', 409, `用户名已被占用: ${input.username}`);
      }
      throw this.wrap(error, '创建用户失败');
    }
  }

  async findByUsername(username: string): Promise<UserRow | undefined> {
    // utf8mb4_unicode_ci：WHERE username = ? 天然大小写不敏感，注册/登录同口径
    const rows = await this.selectRows<UserDbRow>(
      'SELECT id, username, password_hash, nickname, token_version, last_login_at, created_at FROM users WHERE username = ? LIMIT 1',
      [username],
      '查询用户失败',
    );
    return rows[0] ? this.toUser(rows[0]) : undefined;
  }

  async findUserById(id: number): Promise<UserRow | undefined> {
    const rows = await this.selectRows<UserDbRow>(
      'SELECT id, username, password_hash, nickname, token_version, last_login_at, created_at FROM users WHERE id = ? LIMIT 1',
      [id],
      '查询用户失败',
    );
    return rows[0] ? this.toUser(rows[0]) : undefined;
  }

  async bumpTokenVersion(id: number): Promise<void> {
    await this.exec('UPDATE users SET token_version = token_version + 1 WHERE id = ?', [id], '登出失败');
  }

  async touchLastLogin(id: number): Promise<void> {
    await this.exec('UPDATE users SET last_login_at = NOW() WHERE id = ?', [id], '更新登录时间失败');
  }

  /* ----- 策略 ----- */

  async listStrategies(userId: number): Promise<Strategy[]> {
    const rows = await this.selectRows<StrategyDbRow>(
      'SELECT id, name, universe, rebalance, benchmark, factors, status, metrics, curve, bench_curve, holdings, updated_at FROM strategies WHERE user_id = ? ORDER BY created_at, id',
      [userId],
      '查询策略列表失败',
    );
    return rows.map((r) => this.toStrategy(r));
  }

  async getStrategy(userId: number, id: string): Promise<Strategy | undefined> {
    const rows = await this.selectRows<StrategyDbRow>(
      'SELECT id, name, universe, rebalance, benchmark, factors, status, metrics, curve, bench_curve, holdings, updated_at FROM strategies WHERE user_id = ? AND id = ? LIMIT 1',
      [userId, id],
      '查询策略失败',
    );
    return rows[0] ? this.toStrategy(rows[0]) : undefined;
  }

  async saveStrategy(userId: number, strategy: Strategy): Promise<void> {
    try {
      await this.exec(
        `INSERT INTO strategies (id, user_id, name, universe, rebalance, benchmark, factors, status, metrics, curve, bench_curve, holdings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
         ON DUPLICATE KEY UPDATE name = new.name, universe = new.universe, rebalance = new.rebalance,
           benchmark = new.benchmark, factors = new.factors, status = new.status, metrics = new.metrics,
           curve = new.curve, bench_curve = new.bench_curve, holdings = new.holdings`,
        [
          strategy.id, userId, strategy.name, strategy.universe, strategy.rebalance, strategy.benchmark,
          JSON.stringify(strategy.factors), strategy.status,
          strategy.metrics ? JSON.stringify(strategy.metrics) : null,
          JSON.stringify(strategy.curve), JSON.stringify(strategy.benchCurve),
          JSON.stringify(strategy.holdings),
        ],
        '保存策略失败',
      );
    } catch (error) {
      throw this.wrap(error, '保存策略失败');
    }
  }

  async deleteStrategy(userId: number, id: string): Promise<boolean> {
    const result = await this.exec(
      'DELETE FROM strategies WHERE user_id = ? AND id = ?',
      [userId, id],
      '删除策略失败',
    );
    return result.affectedRows > 0;
  }

  /* ----- 会话 ----- */

  async listConversations(userId: number): Promise<Conversation[]> {
    const convs = await this.selectRows<ConversationDbRow>(
      'SELECT id, title, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC',
      [userId],
      '查询会话列表失败',
    );
    if (convs.length === 0) return [];
    const placeholders = convs.map(() => '?').join(', ');
    const messages = await this.selectRows<MessageDbRow & { conversation_id: string }>(
      `SELECT conversation_id, id, role, bubble, card, time FROM messages WHERE conversation_id IN (${placeholders}) ORDER BY conversation_id, id`,
      convs.map((c) => c.id),
      '查询会话消息失败',
    );
    const byConv = new Map<string, ChatMessage[]>();
    for (const m of messages) {
      const list = byConv.get(m.conversation_id) ?? [];
      list.push(this.toMessage(m));
      byConv.set(m.conversation_id, list);
    }
    return convs.map((c) => this.toConversation(c, byConv.get(c.id) ?? []));
  }

  async getConversation(userId: number, id: string): Promise<Conversation | undefined> {
    return this.readConversation(userId, id);
  }

  async newConversation(userId: number): Promise<Conversation> {
    const id = 'c' + Date.now() + Math.random().toString(36).slice(2, 6);
    await this.withConn(async (conn) => {
      await conn.execute('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)', [id, userId, '新对话']);
      await conn.execute(
        'INSERT INTO messages (conversation_id, role, bubble, card, time) VALUES (?, ?, ?, NULL, ?)',
        [id, 'agent', WELCOME_TEXT, nowTime()],
      );
    });
    const conv = await this.readConversation(userId, id);
    if (!conv) throw new Error(`会话创建后读取失败: id=${id}`);
    return conv;
  }

  async deleteConversation(userId: number, id: string): Promise<boolean> {
    // messages 由 ON DELETE CASCADE 一并删除
    const result = await this.exec(
      'DELETE FROM conversations WHERE user_id = ? AND id = ?',
      [userId, id],
      '删除会话失败',
    );
    return result.affectedRows > 0;
  }

  async clearConversation(userId: number, id: string): Promise<Conversation | undefined> {
    const conv = await this.readConversation(userId, id);
    if (!conv) return undefined;
    await this.withConn(async (conn) => {
      await conn.execute('DELETE FROM messages WHERE conversation_id = ?', [id]);
      await conn.execute("UPDATE conversations SET title = '新对话', updated_at = NOW() WHERE id = ?", [id]);
      await conn.execute(
        'INSERT INTO messages (conversation_id, role, bubble, card, time) VALUES (?, ?, ?, NULL, ?)',
        [id, 'agent', WELCOME_TEXT, nowTime()],
      );
    });
    return this.readConversation(userId, id);
  }

  async appendMessages(userId: number, id: string, msgs: ChatMessage[]): Promise<Conversation | undefined> {
    const conv = await this.readConversation(userId, id);
    if (!conv) return undefined;
    await this.withConn(async (conn) => {
      for (const m of msgs) {
        await conn.execute(
          'INSERT INTO messages (conversation_id, role, bubble, card, time) VALUES (?, ?, ?, ?, ?)',
          [id, m.role, m.bubble, m.card ? JSON.stringify(m.card) : null, m.time],
        );
      }
      // ON UPDATE CURRENT_TIMESTAMP 只在本行字段变更时触发，这里必须显式更新
      await conn.execute('UPDATE conversations SET updated_at = NOW() WHERE id = ?', [id]);
    });
    return this.readConversation(userId, id);
  }

  async renameConversationFromFirstMessage(userId: number, id: string, text: string): Promise<void> {
    const title = text.length > 16 ? text.slice(0, 16) + '…' : text;
    await this.exec(
      "UPDATE conversations SET title = ? WHERE user_id = ? AND id = ? AND title = '新对话'",
      [title, userId, id],
      '会话命名失败',
    );
  }

  /* ----- 用户设置 ----- */

  async getSettings(userId: number): Promise<UserSettingsRow> {
    const rows = await this.selectRows<{ notify: number; report: number; risk: string }>(
      'SELECT notify, report, risk FROM user_settings WHERE user_id = ? LIMIT 1',
      [userId],
      '查询用户设置失败',
    );
    if (rows[0]) {
      return { notify: !!rows[0].notify, report: !!rows[0].report, risk: rows[0].risk };
    }
    // 自愈：注册早于该表/默认行缺失时补建
    await this.exec('INSERT INTO user_settings (user_id) VALUES (?)', [userId], '初始化用户设置失败');
    return { notify: true, report: true, risk: '稳健型' };
  }

  async updateSetting(userId: number, key: SettingKey, patch: { on?: boolean; value?: string }): Promise<void> {
    const column = ({ notify: 'notify', report: 'report', risk: 'risk' } as const)[key];
    const value = key === 'risk' ? patch.value : patch.on ? 1 : 0;
    if (value === undefined) return;
    await this.exec(
      `UPDATE user_settings SET ${column} = ? WHERE user_id = ?`,
      [value, userId],
      '更新用户设置失败',
    );
  }

  /* ----- 内部工具 ----- */

  private toUser(r: UserDbRow): UserRow {
    return {
      id: r.id,
      username: r.username,
      passwordHash: r.password_hash,
      nickname: r.nickname,
      tokenVersion: r.token_version,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
    };
  }

  private toStrategy(r: StrategyDbRow): Strategy {
    return {
      id: r.id,
      name: r.name,
      status: r.status as Strategy['status'],
      universe: r.universe,
      rebalance: r.rebalance,
      benchmark: r.benchmark,
      updatedAt: String(r.updated_at ?? '').slice(0, 10),
      factors: (r.factors ?? []) as Strategy['factors'],
      metrics: (r.metrics ?? null) as Strategy['metrics'],
      curve: (r.curve ?? []) as number[],
      benchCurve: (r.bench_curve ?? []) as number[],
      holdings: (r.holdings ?? []) as Strategy['holdings'],
    };
  }

  private toConversation(r: ConversationDbRow, messages: ChatMessage[]): Conversation {
    return { id: r.id, title: r.title, messages, updatedAt: Date.parse(String(r.updated_at).replace(' ', 'T')) };
  }

  private toMessage(r: MessageDbRow): ChatMessage {
    const msg: ChatMessage = { role: r.role as ChatMessage['role'], bubble: r.bubble, time: r.time };
    if (r.card) msg.card = r.card as AgentCard;
    return msg;
  }

  /** 读单个会话（含消息）；跨用户的 id 一律视为不存在 */
  private async readConversation(userId: number, id: string): Promise<Conversation | undefined> {
    const convs = await this.selectRows<ConversationDbRow>(
      'SELECT id, title, updated_at FROM conversations WHERE user_id = ? AND id = ? LIMIT 1',
      [userId, id],
      '查询会话失败',
    );
    if (!convs[0]) return undefined;
    const msgs = await this.selectRows<MessageDbRow>(
      'SELECT id, role, bubble, card, time FROM messages WHERE conversation_id = ? ORDER BY id',
      [id],
      '查询会话消息失败',
    );
    return this.toConversation(convs[0], msgs.map((m) => this.toMessage(m)));
  }

  private isDupEntry(error: unknown): boolean {
    return (error as { code?: string; errno?: number })?.code === 'ER_DUP_ENTRY';
  }

  /** 统一把存储异常包装成 502（业务异常原样上抛） */
  private wrap(error: unknown, label: string): unknown {
    if (error instanceof ApiException) return error;
    const msg = (error as Error)?.message?.slice(0, 200) ?? String(error);
    this.logger.error(`${label}: ${msg}`);
    return new ApiException('DATA_SOURCE_ERROR', 502, `用户库访问失败: ${msg}`);
  }

  /** 连接池懒创建；配置缺失时给出可操作的报错信息 */
  private getPool(): Pool {
    if (this.pool) return this.pool;
    const db = this.config.getOrThrow<{ host: string; port: number; user: string; password: string; database: string; connectionLimit: number }>('userDb');
    if (!db.user) {
      throw new ApiException('DATA_SOURCE_ERROR', 502, '用户库未配置：请在 .env 中填写 USER_DB_HOST / USER_DB_USER / USER_DB_PASSWORD');
    }
    this.pool = createPool({
      host: db.host,
      port: db.port,
      user: db.user,
      password: db.password,
      database: db.database,
      connectionLimit: db.connectionLimit,
      dateStrings: true, // DATETIME → 'YYYY-MM-DD HH:MM:SS'，避免时区二义性
    });
    return this.pool;
  }

  /** SELECT：返回行数组 */
  private async selectRows<T>(sql: string, params: (string | number | null)[], label: string): Promise<T[]> {
    try {
      const [rows] = await this.getPool().execute(sql, params);
      return rows as T[];
    } catch (error) {
      throw this.wrap(error, label);
    }
  }

  /** INSERT/UPDATE/DELETE：只关心影响行数 */
  private async exec(sql: string, params: (string | number | null)[], label: string): Promise<{ affectedRows: number }> {
    try {
      const [result] = await this.getPool().execute(sql, params);
      return result as { affectedRows: number };
    } catch (error) {
      throw this.wrap(error, label);
    }
  }

  private async withConn<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
    const conn = await this.getPool().getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }
}
