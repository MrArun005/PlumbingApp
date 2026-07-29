/**
 * Dispatch inputs and outputs.
 *
 * Everything the ranking function needs arrives as a plain value — including
 * `now` and any randomness — so a year of dispatch decisions can be replayed
 * offline. There are no Prisma types here on purpose: the runtime layer maps
 * database rows into these shapes.
 */

export type UrgencyTier = 'E0' | 'E1' | 'E2' | 'E3';
export type SkillTier = 'L1' | 'L2' | 'L3';

/** Ordering for skill tiers — a higher tier can serve a lower requirement. */
export const SKILL_RANK: Record<SkillTier, number> = { L1: 1, L2: 2, L3: 3 };

export interface LatLng {
  lat: number;
  lng: number;
}

export interface DispatchJob {
  jobId: string;
  location: LatLng;
  urgencyTier: UrgencyTier;
  /** Category the service belongs to; partners must be certified for it. */
  categoryId: string;
  requiredSkillTier: SkillTier;
  requiredTools: string[];
  /** Partners who already declined or timed out — never re-offered. */
  declinedBy: string[];
  /** Set once the customer is an AMC Plus member (priority SOS queue). */
  priorityQueue?: boolean;
}

export interface CandidatePartner {
  partnerId: string;
  location: LatLng;
  onlineStatus: 'OFFLINE' | 'ONLINE' | 'ON_JOB';
  skillTier: SkillTier;
  certifiedCategoryIds: string[];
  tools: string[];
  activeJobCount: number;
  emergencyOptIn: boolean;
  /** 0–1. Partners below the floor are filtered out entirely. */
  acceptanceRate7d: number;
  /** 1–5, or null for a partner with no ratings yet. */
  ratingAvg90d: number | null;
  /** 0–1. */
  firstVisitResolutionRate: number;
  /** Completions in this job's category — proxy for specialisation. */
  categoryCompletions: number;
  /** Jobs served in the last 24 h — drives the fairness boost. */
  jobsLast24h: number;
  openComplaints: number;
  /** True when this partner is on a paid standby shift right now. */
  onStandby?: boolean;
}

export interface RingConfig {
  ring: number;
  radiusMeters: number;
  /** How many partners are offered the job in this ring. */
  topN: number;
  /** How long the ring waits before escalating. */
  windowSeconds: number;
  /** Used to normalise the ETA term of the score. */
  maxEtaMinutes: number;
  /** Ring 3 opens up to the paid standby pool. */
  includeStandbyPool?: boolean;
  /** Ring 4 is the human dispatcher desk — no automated offers. */
  dispatcherDesk?: boolean;
}

export interface RankedOffer {
  partnerId: string;
  score: number;
  etaMinutes: number;
  distanceMeters: number;
  /** Every score term, for the ops board and for tuning the weights. */
  scoreBreakdown: {
    eta: number;
    rating: number;
    firstVisitResolution: number;
    categoryExperience: number;
    fairness: number;
    complaintPenalty: number;
  };
}

/** Why a partner was excluded — surfaced on the ops board, never guessed at. */
export type ExclusionReason =
  | 'OFFLINE'
  | 'SKILL_TIER_TOO_LOW'
  | 'NOT_CERTIFIED_FOR_CATEGORY'
  | 'MISSING_TOOLS'
  | 'ALREADY_ON_JOB'
  | 'OUTSIDE_RING_RADIUS'
  | 'NOT_EMERGENCY_OPTED_IN'
  | 'ALREADY_DECLINED'
  | 'ACCEPTANCE_RATE_TOO_LOW'
  | 'STANDBY_POOL_ONLY';

export interface Exclusion {
  partnerId: string;
  reason: ExclusionReason;
}

export interface RankResult {
  offers: RankedOffer[];
  excluded: Exclusion[];
}
