-- =====================================================================
-- AlphaSage 用户库表结构（M13 登录鉴权与多用户）
-- 目标库：alphasage_user（团队共享 MySQL，utf8mb4 / InnoDB）
-- 执行：mysql -h <USER_DB_HOST> -P 3306 -u alphasage -p alphasage_user < user-tables.sql
-- 约定：主数据一律带 user_id 隔离；conversations/messages 另冗余 username 列（用户名不可改，写入时查取）便于直接浏览；密码只存 bcrypt 哈希（60 字符），永不回传；
--       JSON 列的结构与 src/types.ts 的 Strategy/ChatMessage 字段级一致；
--       username 大小写不敏感唯一（utf8mb4_unicode_ci：Zhang 与 zhang 视为同一账号，
--       注册与登录查找必须同一 collation 口径，勿在列上另指定 _bin）；
--       messages 一行存一次问答（ask 用户提问 + answer 智能体回复），顺序以自增 id
--       为准（ORDER BY id），不另设序号列（并发安全）；ask 为 NULL 的行是开场欢迎语
--       （仅 AI 开场，无提问）；ask_time/answer_time 由应用层在写入时刻生成（HH:mm），
--       不从 created_at 反推（避免时区偏差）
-- 幂等：IF NOT EXISTS + 唯一键防重，可重复执行
-- 注意：conversations.updated_at 的 ON UPDATE 只在本行变更时触发——appendMessages
--       必须显式 UPDATE conversations SET updated_at=CURRENT_TIMESTAMP（会话列表按它倒序），
--       且同一次发消息的问答行 INSERT 放同一事务；
--       register 并发撞名捕获 ER_DUP_ENTRY 映射 409 USERNAME_TAKEN（勿漏成 500）；
--       strategies 相关 DTO 需补 MaxLength（name≤80、universe/benchmark≤40、rebalance≤20），
--       否则严格模式超长插入直接 500
-- =====================================================================

-- 1. 账号表
CREATE TABLE IF NOT EXISTS users (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(24)  NOT NULL COMMENT '登录名，3~24 位字母/数字/下划线',
  password_hash VARCHAR(60)  NOT NULL COMMENT 'bcrypt 哈希（固定 60 字符），任何接口不返回',
  nickname      VARCHAR(40)  NOT NULL DEFAULT '' COMMENT '昵称，缺省取 username',
  token_version INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '登出时 +1，payload.ver 不匹配的旧 JWT 全部失效',
  last_login_at DATETIME     NULL COMMENT '最近登录时间（登录成功时 UPDATE），API-17 lastLogin 数据源',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间，API-17 registerDate 数据源',
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '最后变更时间',
  UNIQUE KEY uk_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户账号';

-- 2. 用户设置（与 users 一对一；字段口径同 API-17/18）
CREATE TABLE IF NOT EXISTS user_settings (
  user_id    BIGINT UNSIGNED NOT NULL PRIMARY KEY COMMENT '即 users.id',
  notify     TINYINT(1) NOT NULL DEFAULT 1 COMMENT '消息提醒（toggle）',
  report     TINYINT(1) NOT NULL DEFAULT 1 COMMENT '回测报告（toggle）',
  risk       VARCHAR(20) NOT NULL DEFAULT '稳健型' COMMENT '风险偏好（single），存中文显示值：保守型/稳健型/平衡型/积极型（口径同前端 choices 与 API-17 下发，非英文枚举；不加 CHECK，应用层校验）',
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户设置';

-- 3. 策略表（曲线/指标/持仓用 JSON 列，draft 时回测产物为 NULL）
CREATE TABLE IF NOT EXISTS strategies (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY COMMENT '策略 id（UUID）',
  user_id     BIGINT UNSIGNED NOT NULL COMMENT '归属用户',
  name        VARCHAR(80)  NOT NULL COMMENT '策略名',
  universe    VARCHAR(40)  NOT NULL DEFAULT '' COMMENT '股票池',
  rebalance   VARCHAR(20)  NOT NULL DEFAULT '' COMMENT '调仓频率',
  benchmark   VARCHAR(40)  NOT NULL DEFAULT '' COMMENT '业绩基准',
  factors     JSON         NOT NULL COMMENT '因子配置 [{name, weight}]，归一化后合计 100',
  status      VARCHAR(10)  NOT NULL DEFAULT 'draft' COMMENT 'draft=草稿 / running=运行中(种子策略) / done=已回测',
  CONSTRAINT chk_strategy_status CHECK (status IN ('draft','running','done')),
  metrics     JSON         NULL COMMENT '回测指标（draft 时 NULL）',
  curve       JSON         NULL COMMENT '净值曲线（起点 100，30 点）',
  bench_curve JSON         NULL COMMENT '基准曲线',
  holdings    JSON         NULL COMMENT '持仓明细',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user (user_id),
  CONSTRAINT fk_strategy_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='策略';

-- 4. 会话表
CREATE TABLE IF NOT EXISTS conversations (
  id         VARCHAR(36) NOT NULL PRIMARY KEY COMMENT '会话 id',
  user_id    BIGINT UNSIGNED NOT NULL COMMENT '归属用户',
  username   VARCHAR(24) NOT NULL DEFAULT '' COMMENT '冗余用户名：注册后不可改；默认空串兼容旧代码写入，新代码总是显式写入真实用户名',
  title      VARCHAR(80) NOT NULL DEFAULT '新对话' COMMENT '标题，按首条用户消息前 16 字命名',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_updated (user_id, updated_at),
  CONSTRAINT fk_conv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话';

-- 5. 消息表（一行 = 一次问答：ask 用户提问 + answer 智能体回复；ask 为 NULL 的行是
--    开场欢迎语；顺序按自增 id；card 当前链路为 NULL，契约保留。
--    2026-10-08 由"一行一条消息（role/bubble）"合并而来，旧数据备份在 messages_bak_20261008）
CREATE TABLE IF NOT EXISTS messages (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id VARCHAR(36) NOT NULL COMMENT '所属会话',
  username        VARCHAR(24) NOT NULL DEFAULT '' COMMENT '冗余用户名：默认空串兼容旧代码，新代码总是显式写入',
  ask             TEXT         NULL COMMENT '用户提问（≤2000 字，DTO 层校验）；NULL = 开场欢迎语（无提问）',
  answer          TEXT         NOT NULL COMMENT '智能体回复',
  card            JSON         NULL COMMENT '回答附带卡片（report/backtest/stocks，契约保留）',
  ask_time        VARCHAR(8)   NOT NULL DEFAULT '' COMMENT '提问展示用 HH:mm（欢迎语行为空串），写入时刻由应用层生成',
  answer_time     VARCHAR(8)   NOT NULL DEFAULT '' COMMENT '回答展示用 HH:mm，写入时刻由应用层生成',
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conv_id (conversation_id, id),
  CONSTRAINT fk_msg_conv2 FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会话消息（一行=一次问答；ask 为 NULL 的行是开场欢迎语）';
