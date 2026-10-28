# src/common — 横切关注点

```text
common/
├── api-error.filter.ts           # 全局异常过滤器：业务异常 → 统一错误体
├── api.exception.ts              # 业务异常类（code/httpStatus/message）
├── client-log.ts / client-logs.controller.ts   # 前端日志上报通道
├── conversation-log.ts           # 会话日志工具
├── current-user.decorator.ts     # @UserId 参数装饰器（从 JWT 取）
├── file-console.logger.ts        # 文件控制台日志（落 logs/）
├── http-access.interceptor.ts    # HTTP 访问日志拦截器
├── jwt-auth.guard.ts             # JWT 全局守卫
├── public.decorator.ts           # @Public 免鉴权标记
└── time.ts                       # 时间工具
```
