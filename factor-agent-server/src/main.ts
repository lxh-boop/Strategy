import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiException } from './common/api.exception';
import { ApiErrorFilter } from './common/api-error.filter';
import { FileConsoleLogger } from './common/file-console.logger';
import { HttpAccessInterceptor } from './common/http-access.interceptor';

async function bootstrap() {
  // bufferLogs：启动期间的日志先缓存，useLogger 挂上文件日志器时自动冲刷落盘
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new FileConsoleLogger());

  // 前后端分离：前端 Vite(5173) 通过代理或直连访问，本地联调放开 CORS
  app.enableCors({ origin: true, credentials: true });

  app.useGlobalFilters(new ApiErrorFilter());
  // 请求访问日志：每请求一行进 logs/backend/，"到没到后端"一锤定音
  app.useGlobalInterceptors(new HttpAccessInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) =>
        new ApiException(
          'INVALID_ARGUMENT',
          400,
          errors
            .map((e) => Object.values((e.constraints ?? {}) as Record<string, string>).join('；'))
            .join('；'),
        ),
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`factor-agent-server 已启动: http://127.0.0.1:${port}`);
}

bootstrap();
