import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiException } from './api.exception';

/** 全局异常 → { "error": { "code", "message" } }（前端契约 §1.错误格式） */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const where = `${req.method} ${req.originalUrl}`;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = '服务内部错误';

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      const body = exception.getResponse() as { code: string; message: string };
      code = body.code;
      message = body.message;
      // 业务异常也留痕：日志可查谁在哪个接口被拒（如登录失败/重名 409）
      this.logger.warn(`业务异常 [${code}] ${message} @ ${where}`);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message ?? exception.message);
      message = Array.isArray(raw) ? raw.join('；') : String(raw);
      code =
        status === HttpStatus.BAD_REQUEST
          ? 'INVALID_ARGUMENT'
          : status === HttpStatus.NOT_FOUND
            ? 'NOT_FOUND'
            : status === HttpStatus.UNAUTHORIZED
              ? 'UNAUTHORIZED'
              : status === HttpStatus.SERVICE_UNAVAILABLE
                ? 'SERVICE_UNAVAILABLE'
                : status === HttpStatus.BAD_GATEWAY || status === HttpStatus.GATEWAY_TIMEOUT
                  ? 'UPSTREAM_FAILED'
                  : 'REQUEST_FAILED';
      this.logger.warn(`请求异常 [${status} ${code}] ${message} @ ${where}`);
    } else {
      // 未处理异常：带请求位置 + 完整错误栈落盘，日志能定位到代码行
      const err = exception instanceof Error ? exception : undefined;
      this.logger.error(
        `未处理异常 @ ${where}: ${err ? err.message : String(exception)}`,
        err?.stack,
      );
    }

    res.status(status).json({ error: { code, message } });
  }
}
