/**
 * Broadcast ring ladders, per urgency tier (BUILD-PROMPT "Rings").
 *
 * E0: 3 km/top5/45s → 6 km/top8/45s → 10 km + standby pool/top12/60s →
 *     dispatcher desk/180s
 * E1: same radii, 90-second windows.
 * E2/E3: a single wide ring — these are batch-optimised for route density every
 *     15 minutes rather than raced on ETA, so the ladder is not the mechanism.
 */
import type { RingConfig, UrgencyTier } from './types';

const E0_RINGS: RingConfig[] = [
  { ring: 1, radiusMeters: 3_000, topN: 5, windowSeconds: 45, maxEtaMinutes: 20 },
  { ring: 2, radiusMeters: 6_000, topN: 8, windowSeconds: 45, maxEtaMinutes: 30 },
  {
    ring: 3,
    radiusMeters: 10_000,
    topN: 12,
    windowSeconds: 60,
    maxEtaMinutes: 45,
    includeStandbyPool: true,
  },
  {
    ring: 4,
    radiusMeters: 10_000,
    topN: 0,
    windowSeconds: 180,
    maxEtaMinutes: 45,
    dispatcherDesk: true,
  },
];

const E1_RINGS: RingConfig[] = E0_RINGS.map((r) => ({
  ...r,
  windowSeconds: r.dispatcherDesk === true ? r.windowSeconds : 90,
}));

const SCHEDULED_RINGS: RingConfig[] = [
  { ring: 1, radiusMeters: 12_000, topN: 10, windowSeconds: 900, maxEtaMinutes: 90 },
];

export function ringsFor(tier: UrgencyTier): RingConfig[] {
  switch (tier) {
    case 'E0':
      return E0_RINGS;
    case 'E1':
      return E1_RINGS;
    case 'E2':
    case 'E3':
      return SCHEDULED_RINGS;
  }
}

/**
 * Total seconds before the ladder is exhausted. For E0 this must stay under the
 * 10-minute money-back guarantee window, or the guarantee fires before the
 * dispatcher desk has even had its turn.
 */
export function ladderDurationSeconds(tier: UrgencyTier): number {
  return ringsFor(tier).reduce((total, r) => total + r.windowSeconds, 0);
}

/** The E0 guarantee: no assignment within this window = auto-refund + credit. */
export const E0_GUARANTEE_SECONDS = 600;

/** Arrival SLA per tier, in minutes. E2/E3 are slot-based, not clock-based. */
export const ARRIVAL_SLA_MINUTES: Record<UrgencyTier, number | null> = {
  E0: 30,
  E1: 120,
  E2: null,
  E3: null,
};
