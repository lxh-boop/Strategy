import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';

/* ==========================================================
   请求访问日志（判官日志）：每个 HTTP 请求一行，随 FileConsoleLogger
   进 logs/backend/YYYY-MM-DD.log。

     行示例： POST /api/conversations/c1/chat/stream → 200 · 3214ms
             POST /api/auth/login → 401 · 8ms（用户名或密码错误）

   用途：一锤定音"请求到底到没到后端"——前端报发送失败时，
   若本日志无对应行，问题在链路/代理层而非业务层。
   SSE 流式接口在流结束（控制器 resolve）时才记一行，含整段流耗时。
   ========================================================== */
@Injectable()
export class HttpAccessInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpAccess');

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest<{ method?: string; originalUrl?: string }>();
    const res = ctx.switchToHttp().getResponse<{ statusCode?: number }>();
    const method = req.method ?? '-';
    const url = req.originalUrl ?? '-';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => this.logger.log(`${method} ${url} → ${res.statusCode ?? 200} · ${Date.now() - start}ms`),
        error: (e: { status?: number; message?: string }) =>
          this.logger.warn(
            `${method} ${url} → ${e?.status ?? 500} · ${Date.now() - start}ms` +
              (e?.message ? `（${String(e.message).slice(0, 120)}）` : ''),
          ),
      }),
    );
  }
}
