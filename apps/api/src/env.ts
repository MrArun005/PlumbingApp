/**
 * API environment — extends the platform base schema. Validated ONCE in
 * main.ts before Nest boots; injected everywhere via the ENV token.
 */
import { z } from 'zod';
import { baseEnvSchema } from '@pipefix/shared';

export const apiEnvSchema = baseEnvSchema.extend({
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SEC: z.coerce.number().int().positive().default(900), // 15 min
  JWT_REFRESH_TTL_SEC: z.coerce.number().int().positive().default(2_592_000), // 30 days
  OTP_TTL_SEC: z.coerce.number().int().positive().default(300),
  OTP_MAX_VERIFY_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_MAX_REQUESTS_PER_WINDOW: z.coerce.number().int().positive().default(3),
  OTP_REQUEST_WINDOW_SEC: z.coerce.number().int().positive().default(900),
  CATALOG_CACHE_TTL_SEC: z.coerce.number().int().positive().default(300),
  DEFAULT_CITY: z.string().min(1).default('Bengaluru'),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

/** Nest injection tokens (explicit — no magic strings scattered around). */
export const ENV = Symbol('ENV');
export const REDIS = Symbol('REDIS');
export const PRISMA = Symbol('PRISMA');
export const LOGGER = Symbol('LOGGER');
