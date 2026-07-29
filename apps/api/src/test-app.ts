/**
 * Test harness: boots the real Nest app against the docker-compose Postgres
 * and Redis. Tests that use it skip themselves when infra is unreachable, so
 * `pnpm test` stays green on a machine without Docker.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { AppModule } from './app.module';
import { AppErrorFilter } from './common/app-error.filter';
import { LOGGER, apiEnvSchema, type ApiEnv } from './env';
import { traceMiddleware } from './logging/logger';

export const TEST_ENV: ApiEnv = apiEnvSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL:
    process.env.DATABASE_URL ??
    'postgresql://pipefix:pipefix_dev_pw@localhost:5432/pipefix?schema=public',
  REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
  // 32+ chars; test-only, never a real secret.
  JWT_ACCESS_SECRET: 'test-secret-please-do-not-use-in-prod-0001',
  LOG_LEVEL: 'silent',
});

export async function infraIsUp(): Promise<boolean> {
  const redis = new Redis(TEST_ENV.REDIS_URL, {
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    await redis.ping();
    const { createPrismaClient } = await import('@pipefix/db');
    const prisma = createPrismaClient(TEST_ENV.DATABASE_URL);
    await prisma.$queryRaw`SELECT 1`;
    await prisma.$disconnect();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

export async function createTestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forEnv(TEST_ENV), { logger: false });
  app.use(traceMiddleware);
  app.useGlobalFilters(new AppErrorFilter(app.get(LOGGER)));
  await app.init();
  return app;
}
