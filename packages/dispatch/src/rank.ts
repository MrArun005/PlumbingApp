/**
 * The dispatch ranking function — pure, deterministic, and the whole reason
 * `packages/dispatch` has no dependencies on the database.
 *
 * Filter and score are exactly as specified in BUILD-PROMPT "DISPATCH ENGINE".
 * Ties break on partnerId so the same inputs always produce the same order —
 * without that, a simulation is not reproducible and a bug is not findable.
 */
import { estimateEtaMinutes, haversineMeters } from './geo';
import {
  SKILL_RANK,
  type CandidatePartner,
  type DispatchJob,
  type Exclusion,
  type RankResult,
  type RankedOffer,
  type RingConfig,
} from './types';

/** Partners below this 7-day acceptance rate are not offered work. */
export const MIN_ACCEPTANCE_RATE_7D = 0.55;

/** Score weights. Tune these with the simulator, never in production. */
export const WEIGHTS = {
  eta: 0.4,
  rating: 0.25,
  firstVisitResolution: 0.15,
  categoryExperience: 0.1,
  fairness: 0.1,
  complaintPenalty: 0.2,
} as const;

/**
 * Completions at which category experience counts as "fully experienced".
 * Anything above scores the same — the term is about distinguishing a novice
 * from a regular, not rewarding volume without limit.
 */
export const CATEGORY_EXPERIENCE_SATURATION = 25;

/** A partner with no ratings yet is treated as average, not as terrible. */
export const UNRATED_ASSUMPTION = 3.5;

export function rankCandidates(
  job: DispatchJob,
  candidates: readonly CandidatePartner[],
  ring: RingConfig,
  _now: Date,
): RankResult {
  // Ring 4 is a human picking up the phone; there is nothing to rank.
  if (ring.dispatcherDesk === true) {
    return { offers: [], excluded: [] };
  }

  const excluded: Exclusion[] = [];
  const eligible: { partner: CandidatePartner; distanceMeters: number; etaMinutes: number }[] = [];
  const isEmergency = job.urgencyTier === 'E0' || job.urgencyTier === 'E1';

  for (const partner of candidates) {
    const distanceMeters = haversineMeters(job.location, partner.location);

    // Order matters only for which reason gets reported; each is exclusive.
    const reason = firstFailingFilter(job, partner, ring, distanceMeters, isEmergency);
    if (reason !== null) {
      excluded.push({ partnerId: partner.partnerId, reason });
      continue;
    }

    eligible.push({ partner, distanceMeters, etaMinutes: estimateEtaMinutes(distanceMeters) });
  }

  const offers: RankedOffer[] = eligible
    .map(({ partner, distanceMeters, etaMinutes }) => {
      const breakdown = scoreBreakdown(partner, etaMinutes, ring);
      return {
        partnerId: partner.partnerId,
        score: round4(
          breakdown.eta +
            breakdown.rating +
            breakdown.firstVisitResolution +
            breakdown.categoryExperience +
            breakdown.fairness -
            breakdown.complaintPenalty,
        ),
        etaMinutes: round4(etaMinutes),
        distanceMeters: Math.round(distanceMeters),
        scoreBreakdown: breakdown,
      };
    })
    // Highest score wins; partnerId breaks ties so ordering is deterministic.
    .sort((a, b) =>
      b.score === a.score ? a.partnerId.localeCompare(b.partnerId) : b.score - a.score,
    )
    .slice(0, ring.topN);

  return { offers, excluded };
}

function firstFailingFilter(
  job: DispatchJob,
  p: CandidatePartner,
  ring: RingConfig,
  distanceMeters: number,
  isEmergency: boolean,
): Exclusion['reason'] | null {
  if (p.onlineStatus !== 'ONLINE') return 'OFFLINE';
  if (SKILL_RANK[p.skillTier] < SKILL_RANK[job.requiredSkillTier]) return 'SKILL_TIER_TOO_LOW';
  if (!p.certifiedCategoryIds.includes(job.categoryId)) return 'NOT_CERTIFIED_FOR_CATEGORY';
  if (!job.requiredTools.every((t) => p.tools.includes(t))) return 'MISSING_TOOLS';
  // One job at a time is an emergency-tier rule; scheduled work can be batched.
  if (isEmergency && p.activeJobCount !== 0) return 'ALREADY_ON_JOB';
  if (distanceMeters > ring.radiusMeters) return 'OUTSIDE_RING_RADIUS';
  if (job.urgencyTier === 'E0' && !p.emergencyOptIn) return 'NOT_EMERGENCY_OPTED_IN';
  if (job.declinedBy.includes(p.partnerId)) return 'ALREADY_DECLINED';
  if (p.acceptanceRate7d < MIN_ACCEPTANCE_RATE_7D) return 'ACCEPTANCE_RATE_TOO_LOW';
  return null;
}

function scoreBreakdown(
  p: CandidatePartner,
  etaMinutes: number,
  ring: RingConfig,
): RankedOffer['scoreBreakdown'] {
  // Clamped so a partner slower than the ring's max ETA scores 0 here rather
  // than going negative and out-weighing every other term.
  const etaTerm = clamp01(1 - etaMinutes / ring.maxEtaMinutes);
  const rating = p.ratingAvg90d ?? UNRATED_ASSUMPTION;
  // Map 1–5 stars onto 0–1.
  const ratingNormalised = clamp01((rating - 1) / 4);
  const categoryNormalised = clamp01(p.categoryCompletions / CATEGORY_EXPERIENCE_SATURATION);
  // Inverse of recent load: an idle partner outranks one who has done 6 jobs.
  const fairnessBoost = 1 / (1 + p.jobsLast24h);

  return {
    eta: round4(WEIGHTS.eta * etaTerm),
    rating: round4(WEIGHTS.rating * ratingNormalised),
    firstVisitResolution: round4(
      WEIGHTS.firstVisitResolution * clamp01(p.firstVisitResolutionRate),
    ),
    categoryExperience: round4(WEIGHTS.categoryExperience * categoryNormalised),
    fairness: round4(WEIGHTS.fairness * fairnessBoost),
    complaintPenalty: round4(p.openComplaints > 0 ? WEIGHTS.complaintPenalty : 0),
  };
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** Keep scores comparable and log-friendly; float noise is not signal. */
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
