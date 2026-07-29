/**
 * Surge pricing for the emergency tiers.
 *
 * Computed per zone per 15-minute bucket from (open emergency requests ÷ online
 * eligible partners), smoothed against the previous bucket so a single request
 * cannot spike the multiplier, then hard-capped.
 *
 * Two rules that keep this defensible rather than exploitative:
 *  - the multiplier is FROZEN onto the booking at creation time, so the price a
 *    customer agreed to cannot drift underneath them
 *  - it is capped at 2.0×, and AMC Plus members are capped lower still
 *
 * The multiplier is an integer ×100 throughout (150 = 1.50×) — floats never
 * touch anything that ends up multiplying money.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type pino from 'pino';
import { LOGGER, PRISMA } from '../env';

/** Hard ceiling. Also enforced independently by the pricing engine. */
export const SURGE_CAP_X100 = 200;
export const SURGE_FLOOR_X100 = 100;

/** Demand:supply ratio at which surge starts climbing. */
export const SURGE_TRIGGER_RATIO = 0.5;

/** Weight given to the previous bucket when smoothing (0–1). */
export const SMOOTHING_ALPHA = 0.5;

export const BUCKET_MINUTES = 15;

export interface SurgeSnapshot {
  zoneKey: string;
  bucketStart: Date;
  multiplierX100: number;
  openRequests: number;
  onlinePartners: number;
  /** Human-readable explanation, shown on the ops board and in audit logs. */
  reason: string;
}

@Injectable()
export class SurgeService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  /** Truncate a timestamp to the start of its 15-minute bucket. */
  static bucketStartFor(now: Date): Date {
    const ms = BUCKET_MINUTES * 60 * 1000;
    return new Date(Math.floor(now.getTime() / ms) * ms);
  }

  /**
   * Current multiplier for a zone, reading the persisted bucket. Falls back to
   * 1.00× when nothing has been computed — never guess upward.
   */
  async currentMultiplierX100(zoneKey: string, now: Date): Promise<number> {
    const bucketStart = SurgeService.bucketStartFor(now);
    const row = await this.prisma.surgeWindow.findUnique({
      where: { h3Index_bucketStart: { h3Index: zoneKey, bucketStart } },
    });
    return row?.multiplierX100 ?? SURGE_FLOOR_X100;
  }

  /**
   * Recompute and persist the multiplier for a zone's current bucket. Called by
   * the scheduler every few minutes and after each emergency intake.
   */
  async recompute(
    zoneKey: string,
    openRequests: number,
    onlinePartners: number,
    now: Date,
  ): Promise<SurgeSnapshot> {
    const bucketStart = SurgeService.bucketStartFor(now);
    const previous = await this.previousBucketMultiplier(zoneKey, bucketStart);

    const raw = computeRawMultiplierX100(openRequests, onlinePartners);
    const smoothed = smooth(previous, raw, SMOOTHING_ALPHA);
    const multiplierX100 = clampSurge(smoothed);

    await this.prisma.surgeWindow.upsert({
      where: { h3Index_bucketStart: { h3Index: zoneKey, bucketStart } },
      create: { h3Index: zoneKey, bucketStart, multiplierX100, openRequests, onlinePartners },
      update: { multiplierX100, openRequests, onlinePartners },
    });

    const reason = explain(openRequests, onlinePartners, raw, multiplierX100);
    this.logger.info({
      event: 'surge.recomputed',
      zoneKey,
      bucketStart: bucketStart.toISOString(),
      openRequests,
      onlinePartners,
      rawX100: raw,
      multiplierX100,
    });

    return { zoneKey, bucketStart, multiplierX100, openRequests, onlinePartners, reason };
  }

  private async previousBucketMultiplier(zoneKey: string, bucketStart: Date): Promise<number> {
    const previousStart = new Date(bucketStart.getTime() - BUCKET_MINUTES * 60 * 1000);
    const row = await this.prisma.surgeWindow.findUnique({
      where: { h3Index_bucketStart: { h3Index: zoneKey, bucketStart: previousStart } },
    });
    return row?.multiplierX100 ?? SURGE_FLOOR_X100;
  }
}

/**
 * Demand pressure → multiplier, before smoothing and capping.
 *
 * Below the trigger ratio there is no surge at all. Above it, the multiplier
 * rises linearly with pressure. With zero partners online the ratio is
 * undefined, so we return the cap — but note that in that situation there is
 * nobody to dispatch to anyway, and the coverage heatmap should already be
 * telling ops not to promise an SLA there.
 */
export function computeRawMultiplierX100(openRequests: number, onlinePartners: number): number {
  if (openRequests <= 0) return SURGE_FLOOR_X100;
  if (onlinePartners <= 0) return SURGE_CAP_X100;

  const ratio = openRequests / onlinePartners;
  if (ratio <= SURGE_TRIGGER_RATIO) return SURGE_FLOOR_X100;

  // ratio 0.5 → 1.00×, ratio 1.5 → 2.00×; linear in between.
  const excess = ratio - SURGE_TRIGGER_RATIO;
  const scaled = SURGE_FLOOR_X100 + Math.round(excess * 100);
  return clampSurge(scaled);
}

/** Exponential smoothing towards the new value. */
export function smooth(previousX100: number, rawX100: number, alpha: number): number {
  return Math.round(previousX100 * alpha + rawX100 * (1 - alpha));
}

export function clampSurge(x100: number): number {
  return Math.min(SURGE_CAP_X100, Math.max(SURGE_FLOOR_X100, x100));
}

function explain(open: number, online: number, raw: number, final: number): string {
  if (final <= SURGE_FLOOR_X100) return 'No surge — supply is keeping up with demand.';
  const capped = raw >= SURGE_CAP_X100 ? ' (capped at 2.0×)' : '';
  return `${open} open emergency request(s) against ${online} available plumber(s)${capped}.`;
}
