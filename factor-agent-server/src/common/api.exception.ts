import { HttpException } from '@nestjs/common';

/** 业务异常：统一输出 { "error": { "code", "message" } } */
export class ApiException extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
  ) {
    super({ code, message }, status);
  }
}
