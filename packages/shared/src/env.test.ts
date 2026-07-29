import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { EnvValidationError } from './errors';
import { baseEnvSchema, loadEnv } from './env';

const validEnv = {
  DATABASE_URL: 'postgresql://pipefix:pw@localhost:5432/pipefix',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = loadEnv(baseEnvSchema, validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.BUSINESS_TIMEZONE).toBe('Asia/Kolkata');
  });

  it('coerces PORT from string', () => {
    const env = loadEnv(baseEnvSchema, { ...validEnv, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  it('fails fast with every missing key listed', () => {
    expect(() => loadEnv(baseEnvSchema, {})).toThrow(EnvValidationError);
    try {
      loadEnv(baseEnvSchema, {});
    } catch (e) {
      const err = e as EnvValidationError;
      expect(err.message).toContain('DATABASE_URL');
      expect(err.message).toContain('REDIS_URL');
    }
  });

  it('rejects a non-IST business timezone — IST is a hard rule', () => {
    expect(() => loadEnv(baseEnvSchema, { ...validEnv, BUSINESS_TIMEZONE: 'UTC' })).toThrow(
      EnvValidationError,
    );
  });

  it('supports app-level extension of the base schema', () => {
    const apiSchema = baseEnvSchema.extend({
      RAZORPAY_KEY_ID: z.string().min(1),
    });
    expect(() => loadEnv(apiSchema, validEnv)).toThrow(EnvValidationError);
    const env = loadEnv(apiSchema, { ...validEnv, RAZORPAY_KEY_ID: 'rzp_test_x' });
    expect(env.RAZORPAY_KEY_ID).toBe('rzp_test_x');
  });
});
