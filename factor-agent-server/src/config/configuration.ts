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
  },
  mysql: {
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? '',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'hems_data',
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 5),
  },
});
