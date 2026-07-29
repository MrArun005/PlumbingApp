/**
 * Environment validation — build-prompt rule 8: no secrets in code, and the
 * process FAILS FAST at boot if configuration is missing or malformed.
 *
 * Each app composes its own schema on top of `baseEnvSchema` and calls
 * `loadEnv(schema)` once at startup, before anything else initialises.
 */
import { z } from 'zod';
import { EnvValidationError } from './errors';

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  PORT: z.coerce.number().int().positive().default(3000),
  // 'silent' is a real pino level — used by tests to keep output clean.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Rule 9: business logic is computed in IST, explicitly — never server-local time.
  BUSINESS_TIMEZONE: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
});

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function loadEnv<S extends z.ZodTypeAny>(
  schema: S,
  source: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new EnvValidationError(`Environment validation failed:\n${problems}`, {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data as z.infer<S>;
}
