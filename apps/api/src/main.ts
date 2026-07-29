import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadEnv } from '@pipefix/shared';
import { AppModule } from './app.module';
import { AppErrorFilter } from './common/app-error.filter';
import { LOGGER, apiEnvSchema } from './env';
import { createLogger, traceMiddleware } from './logging/logger';

async function bootstrap(): Promise<void> {
  // Fail fast on bad configuration, BEFORE anything else initialises.
  const env = loadEnv(apiEnvSchema);
  const logger = createLogger(env.LOG_LEVEL);

  const app = await NestFactory.create(AppModule.forEnv(env), { logger: false });
  app.use(traceMiddleware);
  app.useGlobalFilters(new AppErrorFilter(app.get(LOGGER)));
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  logger.info({ event: 'api.started', port: env.PORT, nodeEnv: env.NODE_ENV });
}

void bootstrap();
