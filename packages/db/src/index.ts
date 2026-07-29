/**
 * Single place the rest of the platform gets its Prisma client from.
 * Apps call `createPrismaClient()` once at boot and inject it.
 */
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

export function createPrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient(databaseUrl ? { datasources: { db: { url: databaseUrl } } } : undefined);
}
