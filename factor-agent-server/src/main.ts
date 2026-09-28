import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ApiException } from './common/api.exception';
import { ApiErrorFilter } from './common/api-error.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 前后端分离：前端 Vite(5173) 通过代理或直连访问，本地联调放开 CORS
  app.enableCors({ origin: true, credentials: true });

  app.useGlobalFilters(new ApiErrorFilter());

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
