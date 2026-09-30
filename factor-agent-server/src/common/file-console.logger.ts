import { ConsoleLogger } from '@nestjs/common';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/** 日志根目录：默认 cwd/logs，环境变量 LOG_DIR 整体覆盖（全局日志与会话日志共用这一个根） */
export function logRootDir(): string {
  return process.env.LOG_DIR?.trim() || join(process.cwd(), 'logs');
}

/* ==========================================================
   全局日志器：控制台输出沿用 NestJS ConsoleLogger，同时把每条日志按天追加落盘。

     文件位置：logs/app-YYYY-MM-DD.log（目录见 logRootDir）
     行格式： [YYYY-MM-DD HH:mm:ss] [级别] [上下文] 正文（error 的异常栈随行附加）

   main.ts 里 app.useLogger() 后全局生效——各处 new Logger(context) 的输出
   （含智能体 agent/tools 节点日志）都会同时进控制台和日志文件。
   ========================================================== */
export class FileConsoleLogger extends ConsoleLogger {
  private readonly logDir = logRootDir();

  constructor() {
    super();
    mkdirSync(this.logDir, { recursive: true });
  }

  override log(message: unknown, context?: string): void {
    super.log(message, context);
    this.append('INFO', message, undefined, context);
  }

  override warn(message: unknown, context?: string): void {
    super.warn(message, context);
    this.append('WARN', message, undefined, context);
  }

  override error(message: unknown, stack?: string, context?: string): void {
    super.error(message, stack, context);
    this.append('ERROR', message, stack, context);
  }

  override debug(message: unknown, context?: string): void {
    super.debug(message, context);
    this.append('DEBUG', message, undefined, context);
  }

  override verbose(message: unknown, context?: string): void {
    super.verbose(message, context);
    this.append('VERBOSE', message, undefined, context);
  }

  /** 一条日志一行，同步追加：服务日志量小，同步写换实现简单、不丢尾条；落盘失败只放弃该条，不抛错打断业务 */
  private append(level: string, message: unknown, stack?: string, context?: string): void {
    const now = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    const time = `${day} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;
    const lines = [
      `[${time}] [${level}]${context ? ` [${context}]` : ''} ${flattenMessage(message)}`,
      ...(stack ? [stack] : []),
    ];
    try {
      appendFileSync(join(this.logDir, `app-${day}.log`), lines.join('\n') + '\n');
    } catch {
      // 磁盘满/权限等写不进去就算了，日志器自身不能成为新的故障源
    }
  }
}

/** message 兼容 string / 对象：非字符串 JSON 化（失败兜底 String()） */
function flattenMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return String(message);
  }
}
