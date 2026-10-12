export default () => ({
  // 注意：本机 8000 被另一个 Python uvicorn 服务占用，默认用 3000
  port: Number(process.env.PORT ?? 3000),
  chat: {
    timeoutMs: Number(process.env.CHAT_TIMEOUT_MS ?? 20_000),
    systemPrompt: process.env.SYSTEM_PROMPT ?? '',
  },
  zhipu: {
    apiKey: process.env.ZHIPU_API_KEY ?? '',
    baseUrl: (process.env.ZHIPU_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4').replace(/\/+$/, ''),
    model: process.env.ZHIPU_MODEL ?? 'glm-4-flash',
    // 推理模型思考开关（GLM thinking）：默认 disabled——思考内容计入 max_tokens，
    // 工具循环里思考量波动大，随机爆发会吃穿预算导致正文为空
    thinking: (process.env.ZHIPU_THINKING ?? 'disabled').toLowerCase(),
  },
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? '',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'herms_data',
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 5),
  },
  // 用户库（M13，可写）：与上面只读因子库分开配置
  userDb: {
    host: process.env.USER_DB_HOST ?? '',
    port: Number(process.env.USER_DB_PORT ?? 3306),
    user: process.env.USER_DB_USER ?? '',
    password: process.env.USER_DB_PASSWORD ?? '',
    database: process.env.USER_DB_DATABASE ?? 'alphasage_user',
    connectionLimit: Number(process.env.USER_DB_CONNECTION_LIMIT ?? 5),
  },
  // 登录鉴权 JWT（M13）：留空 secret 用内置开发密钥，团队联调建议 .env 统一配置
  userJwt: {
    // 留空按未配置处理（?? 挡不住"有这行但值为空"，空串会让签发 JWT 直接 500）
    secret: (process.env.USER_JWT_SECRET ?? '').trim() || 'alphasage-dev-secret-change-me',
    expiresIn: (process.env.USER_JWT_EXPIRES ?? '').trim() || '7d',
  },
});
