import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, runtime } from './app.module';
import { ApiError } from './store';
import { log } from './logger';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException } from '@nestjs/common';

@Catch()
class QuietFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{ status: (code: number) => { json: (body: unknown) => void } }>();
    const code = (exception as { code?: string }).code;
    const status = exception instanceof ApiError
      ? exception.status
      : exception instanceof HttpException
        ? exception.getStatus()
        : code === '42501'
          ? 403
          : 500;
    const message = exception instanceof ApiError
      ? exception.message
      : exception instanceof HttpException
        ? (exception.getStatus() === 404 ? 'not_found' : exception.message)
        : code === '42501'
          ? 'permission_denied'
          : 'internal_error';
    log('request_failed', {
      status,
      message,
      pgCode: code ?? null,
      detail: exception instanceof Error ? exception.message.slice(0, 180) : null,
    });
    response.status(status).json({ error: message });
  }
}

async function main(): Promise<void> {
  const { config, store } = runtime();
  const app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new QuietFilter());
  await app.listen(config.apiPort);
  log('api_listening', { port: config.apiPort, env: config.env });
  const shutdown = async () => {
    await app.close();
    await store.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => { void shutdown(); });
  process.on('SIGINT', () => { void shutdown(); });
}

void main();
