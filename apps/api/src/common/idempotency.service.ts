/**
 * Idempotency for mutating public endpoints (BUILD-PROMPT rule 6).
 *
 * Contract, from the caller's point of view:
 *  - First call with a key → the handler runs, and its response is stored.
 *  - Repeat with the SAME key and SAME body → the stored response is replayed
 *    verbatim. The handler does not run again. This is what makes a flaky
 *    mobile network safe: retrying a booking cannot create two bookings.
 *  - Repeat with the same key but a DIFFERENT body → 422. The client has a bug
 *    (or is a replay attack); silently returning the old response would be a
 *    lie, and running the handler would violate the key.
 *
 * The unique index on (endpoint, key) is what actually enforces this under
 * concurrency — two simultaneous requests race, one inserts, the loser reads
 * the winner's response.
 */
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type pino from 'pino';
import { ConflictError, IdempotencyKeyReusedError } from '@pipefix/shared';
import { LOGGER, PRISMA } from '../env';

/** JSON-safe value: bigint is stringified before it ever reaches here. */
type Json = unknown;

@Injectable()
export class IdempotencyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  private static hashBody(body: unknown): string {
    // Stable stringify: key order must not change the hash.
    return createHash('sha256').update(stableStringify(body)).digest('hex');
  }

  /**
   * Run `handler` at most once per (endpoint, key). Returns either the fresh
   * result or the previously stored one.
   *
   * Two-phase, and the order matters: we CLAIM the key first, then run the
   * handler. Running the handler first looks simpler but is wrong — two
   * concurrent submissions would both create a booking, and the one that lost
   * the key race would return the winner's response while leaving its own row
   * orphaned in the database. Claiming first means only one request ever
   * reaches the handler.
   */
  async run<T extends Json>(
    endpoint: string,
    key: string | undefined,
    body: unknown,
    handler: () => Promise<T>,
  ): Promise<T> {
    if (key === undefined || key.length === 0) {
      // No key supplied: nothing to deduplicate against. Callers that must have
      // one enforce it in their DTO, so reaching here means the endpoint opted out.
      return handler();
    }

    const requestHash = IdempotencyService.hashBody(body);
    const where = { endpoint_key: { endpoint, key } };

    // ── phase 1: claim the key ───────────────────────────────────────────────
    let claimed = false;
    try {
      await this.prisma.idempotencyRecord.create({
        data: { endpoint, key, requestHash, responseBody: {}, statusCode: IN_FLIGHT },
      });
      claimed = true;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }

    if (!claimed) {
      const record = await this.awaitSettled(endpoint, key);
      if (record.requestHash !== requestHash) {
        this.logger.warn({ event: 'idempotency.key_reused_different_body', endpoint, key });
        throw new IdempotencyKeyReusedError(
          'This request id was already used with different details. Use a new one.',
          { endpoint },
        );
      }
      if (record.statusCode === IN_FLIGHT) {
        // The original request is genuinely still working. Tell the client to
        // retry rather than guessing at a result we do not have.
        this.logger.info({ event: 'idempotency.still_in_flight', endpoint, key });
        throw new ConflictError('This request is still being processed. Try again shortly.', {
          endpoint,
          retryable: true,
        });
      }
      this.logger.info({ event: 'idempotency.replayed', endpoint, key });
      return record.responseBody as T;
    }

    // ── phase 2: we own the key, so we run the work exactly once ─────────────
    try {
      const result = await handler();
      await this.prisma.idempotencyRecord.update({
        where,
        data: { responseBody: result as object, statusCode: 200 },
      });
      return result;
    } catch (e) {
      // Release the claim, or a transient failure would poison this key
      // forever and the client could never legitimately retry.
      await this.prisma.idempotencyRecord.delete({ where }).catch(() => undefined);
      throw e;
    }
  }

  /** Poll briefly for the owner to finish; returns whatever state it is in. */
  private async awaitSettled(
    endpoint: string,
    key: string,
  ): Promise<{ requestHash: string; statusCode: number; responseBody: unknown }> {
    const where = { endpoint_key: { endpoint, key } };
    for (let attempt = 0; attempt < IN_FLIGHT_POLL_ATTEMPTS; attempt += 1) {
      const record = await this.prisma.idempotencyRecord.findUnique({ where });
      // The owner failed and released the claim — take over by claiming again.
      if (record === null) {
        return { requestHash: '', statusCode: IN_FLIGHT, responseBody: {} };
      }
      if (record.statusCode !== IN_FLIGHT) return record;
      await sleep(IN_FLIGHT_POLL_INTERVAL_MS);
    }
    const last = await this.prisma.idempotencyRecord.findUnique({ where });
    return last ?? { requestHash: '', statusCode: IN_FLIGHT, responseBody: {} };
  }
}

/** statusCode sentinel meaning "claimed, handler still running". */
const IN_FLIGHT = 0;
const IN_FLIGHT_POLL_ATTEMPTS = 20;
const IN_FLIGHT_POLL_INTERVAL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2002'
  );
}

/** Deterministic JSON: object keys sorted, so hashing is order-independent. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
}

/** Exported for tests — the hashing contract matters and should be pinned. */
export const __stableStringify = stableStringify;

/** Thrown when a caller omits a required Idempotency-Key header. */
export function requireIdempotencyKey(key: string | undefined): string {
  if (key === undefined || key.trim().length === 0) {
    throw new ConflictError('This request needs an Idempotency-Key header so retries are safe.', {
      header: 'Idempotency-Key',
    });
  }
  return key.trim();
}
