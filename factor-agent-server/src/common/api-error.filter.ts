import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { ApiException } from './api.exception';

/** 全局异常 → { "error": { "code", "message" } }（前端契约 §1.错误格式） */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = '服务内部错误';

    if (exception instanceof ApiException) {
      status = exception.getStatus();
      const body = exception.getResponse() as { code: string; message: string };
      code = body.code;
      message = body.message;
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
    } else {
      this.logger.error(`未处理异常: ${exception}`);
    }

    res.status(status).json({ error: { code, message } });
  }
}
