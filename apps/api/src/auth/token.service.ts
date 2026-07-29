/**
 * JWT access tokens + rotating refresh tokens.
 *
 * Refresh rotation: each refresh token is single-use. Redeeming one issues a
 * new pair and deletes the old token. If a token that was already redeemed is
 * presented again, that means it leaked — we revoke the WHOLE family (all
 * sessions for that subject) rather than silently issuing more tokens.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import type pino from 'pino';
import { UnauthorizedError } from '@pipefix/shared';
import { ENV, LOGGER, REDIS, type ApiEnv } from '../env';

export type SubjectType = 'CUSTOMER' | 'PARTNER';

export interface AccessClaims {
  sub: string;
  typ: SubjectType;
  /** Partner tokens are bound to the device that logged in. */
  did?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSec: number;
}

@Injectable()
export class TokenService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  private static hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshKey(hash: string): string {
    return `refresh:${hash}`;
  }

  private familyKey(typ: SubjectType, sub: string): string {
    return `refresh:family:${typ}:${sub}`;
  }

  /**
   * Marker for a token that was legitimately redeemed. Kept for the remaining
   * refresh lifetime so that presenting the same token again is provably a
   * REPLAY (leaked token) rather than merely an unknown string.
   */
  private spentKey(hash: string): string {
    return `refresh:spent:${hash}`;
  }

  async issue(claims: AccessClaims): Promise<TokenPair> {
    const accessToken = jwt.sign(claims, this.env.JWT_ACCESS_SECRET, {
      expiresIn: this.env.JWT_ACCESS_TTL_SEC,
    });

    const refreshToken = randomBytes(32).toString('base64url');
    const hash = TokenService.hash(refreshToken);
    await this.redis.set(
      this.refreshKey(hash),
      JSON.stringify(claims),
      'EX',
      this.env.JWT_REFRESH_TTL_SEC,
    );
    // Track the family so a detected replay can revoke every sibling session.
    await this.redis.sadd(this.familyKey(claims.typ, claims.sub), hash);
    await this.redis.expire(this.familyKey(claims.typ, claims.sub), this.env.JWT_REFRESH_TTL_SEC);

    return { accessToken, refreshToken, accessExpiresInSec: this.env.JWT_ACCESS_TTL_SEC };
  }

  verifyAccess(token: string): AccessClaims {
    try {
      const decoded = jwt.verify(token, this.env.JWT_ACCESS_SECRET);
      if (typeof decoded === 'string') throw new Error('unexpected token payload');
      const { sub, typ, did } = decoded as jwt.JwtPayload & AccessClaims;
      if (typeof sub !== 'string' || (typ !== 'CUSTOMER' && typ !== 'PARTNER')) {
        throw new Error('malformed claims');
      }
      return did === undefined ? { sub, typ } : { sub, typ, did };
    } catch {
      throw new UnauthorizedError('Your session is no longer valid. Please sign in again.');
    }
  }

  /** Single-use redemption. Replay of a spent token revokes the whole family. */
  async rotate(refreshToken: string): Promise<TokenPair> {
    const hash = TokenService.hash(refreshToken);
    const raw = await this.redis.get(this.refreshKey(hash));

    if (raw === null) {
      // Was this token already redeemed once? Then it leaked — someone is
      // replaying it. Tear down every session for that subject.
      const spent = await this.redis.get(this.spentKey(hash));
      if (spent !== null) {
        const claims = JSON.parse(spent) as AccessClaims;
        this.logger.warn({
          event: 'auth.refresh.replay_detected',
          sub: claims.sub,
          typ: claims.typ,
        });
        await this.revokeAll(claims.typ, claims.sub);
      } else {
        this.logger.warn({ event: 'auth.refresh.unknown_token' });
      }
      throw new UnauthorizedError('Your session is no longer valid. Please sign in again.');
    }

    const claims = JSON.parse(raw) as AccessClaims;
    await this.redis.del(this.refreshKey(hash));
    await this.redis.srem(this.familyKey(claims.typ, claims.sub), hash);
    // Remember that THIS token was spent, so a later replay is detectable.
    await this.redis.set(this.spentKey(hash), raw, 'EX', this.env.JWT_REFRESH_TTL_SEC);
    this.logger.info({ event: 'auth.refresh.rotated', sub: claims.sub, typ: claims.typ });
    return this.issue(claims);
  }

  /** Sign out (or forced revocation): drop every refresh token for a subject. */
  async revokeAll(typ: SubjectType, sub: string): Promise<void> {
    const key = this.familyKey(typ, sub);
    const hashes = await this.redis.smembers(key);
    if (hashes.length > 0) {
      // Revoked tokens are not "spent" — presenting one later is not evidence
      // of a leak, so drop both the live keys and any spent markers.
      await this.redis.del(
        ...hashes.map((h) => this.refreshKey(h)),
        ...hashes.map((h) => this.spentKey(h)),
      );
    }
    await this.redis.del(key);
    this.logger.info({ event: 'auth.sessions.revoked', typ, sub, count: hashes.length });
  }
}
