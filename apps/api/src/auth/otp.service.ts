/**
 * Phone-OTP issuance and verification.
 *
 * Design notes:
 * - Codes live in Redis with a TTL; we store only a SHA-256 hash so a Redis
 *   dump never leaks live codes.
 * - Verification is attempt-limited and single-use (the key is deleted on
 *   success) so a code cannot be replayed.
 * - Requests are rate-limited per phone to stop SMS-pumping.
 * - SMS delivery is a stubbed sender (MSG91 arrives with its own WO). In
 *   non-production the code is returned in the response so the flow is
 *   testable end-to-end; in production it never leaves the server.
 */
import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type pino from 'pino';
import { RateLimitedError, UnauthorizedError } from '@pipefix/shared';
import { ENV, LOGGER, REDIS, type ApiEnv } from '../env';

export type OtpAudience = 'CUSTOMER' | 'PARTNER';

export interface OtpIssueResult {
  /** Seconds until the code expires. */
  expiresInSec: number;
  /** Only populated outside production — for local dev and tests. */
  devCode?: string;
}

@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  private codeKey(audience: OtpAudience, phone: string): string {
    return `otp:${audience}:${phone}`;
  }

  private rateKey(audience: OtpAudience, phone: string): string {
    return `otp:rate:${audience}:${phone}`;
  }

  private static hash(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  async request(audience: OtpAudience, phone: string): Promise<OtpIssueResult> {
    const rateKey = this.rateKey(audience, phone);
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, this.env.OTP_REQUEST_WINDOW_SEC);
    if (count > this.env.OTP_MAX_REQUESTS_PER_WINDOW) {
      const ttl = await this.redis.ttl(rateKey);
      this.logger.warn({ event: 'auth.otp.rate_limited', audience, phone, count });
      throw new RateLimitedError('Too many OTP requests. Please try again later.', {
        retryAfterSec: ttl > 0 ? ttl : this.env.OTP_REQUEST_WINDOW_SEC,
      });
    }

    // 6 digits, uniformly random, leading zeros preserved.
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.set(
      this.codeKey(audience, phone),
      JSON.stringify({ hash: OtpService.hash(code), attempts: 0 }),
      'EX',
      this.env.OTP_TTL_SEC,
    );

    // TODO(WO-04b): replace with the MSG91 sender once credentials exist.
    this.logger.info({ event: 'auth.otp.sent', audience, phone, channel: 'stub' });

    return {
      expiresInSec: this.env.OTP_TTL_SEC,
      ...(this.env.NODE_ENV === 'production' ? {} : { devCode: code }),
    };
  }

  /** Throws UnauthorizedError unless the code is correct, unexpired and unused. */
  async verify(audience: OtpAudience, phone: string, code: string): Promise<void> {
    const key = this.codeKey(audience, phone);
    const raw = await this.redis.get(key);
    if (raw === null) {
      this.logger.info({
        event: 'auth.otp.verify_failed',
        audience,
        phone,
        reason: 'expired_or_absent',
      });
      throw new UnauthorizedError('This code has expired. Please request a new one.');
    }

    const record = JSON.parse(raw) as { hash: string; attempts: number };
    if (record.attempts + 1 >= this.env.OTP_MAX_VERIFY_ATTEMPTS) {
      // burn the code on the final attempt, right or wrong
      await this.redis.del(key);
    } else {
      const ttl = await this.redis.ttl(key);
      await this.redis.set(
        key,
        JSON.stringify({ hash: record.hash, attempts: record.attempts + 1 }),
        'EX',
        ttl > 0 ? ttl : this.env.OTP_TTL_SEC,
      );
    }

    if (record.hash !== OtpService.hash(code)) {
      this.logger.info({ event: 'auth.otp.verify_failed', audience, phone, reason: 'wrong_code' });
      throw new UnauthorizedError('That code is not correct. Please check and try again.');
    }

    await this.redis.del(key); // single use
    await this.redis.del(this.rateKey(audience, phone)); // successful login clears the throttle
    this.logger.info({ event: 'auth.otp.verified', audience, phone });
  }
}
