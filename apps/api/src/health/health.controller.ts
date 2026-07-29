import { Controller, Get, Inject } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type Redis from 'ioredis';
import { Public } from '../auth/auth.guard';
import { PRISMA, REDIS } from '../env';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async health(): Promise<{ status: string; db: string; redis: string }> {
    const [db, redis] = await Promise.all([
      this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down'),
      this.redis
        .ping()
        .then(() => 'up')
        .catch(() => 'down'),
    ]);
    return { status: db === 'up' && redis === 'up' ? 'ok' : 'degraded', db, redis };
  }
}
