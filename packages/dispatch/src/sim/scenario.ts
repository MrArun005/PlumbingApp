/**
 * Synthetic city + demand generation for the dispatch simulator.
 *
 * The point is not realism for its own sake — it is to have a repeatable world
 * in which changing a score weight produces a comparable number. Everything is
 * driven by a seeded RNG, so a scenario is fully described by its config.
 */
import { createRng, type Rng } from './rng';
import type { CandidatePartner, DispatchJob, SkillTier, UrgencyTier } from '../types';

/** Three real Bengaluru zone centres, so distances are plausible. */
export const ZONES = [
  { name: 'Koramangala–HSR', lat: 12.934, lng: 77.622 },
  { name: 'Indiranagar', lat: 12.971, lng: 77.641 },
  { name: 'Whitefield', lat: 12.97, lng: 77.75 },
] as const;

export const CATEGORIES = ['cat_leak', 'cat_drain', 'cat_tank', 'cat_geyser'] as const;

export interface ScenarioConfig {
  seed: number;
  /** Emergency jobs to generate. */
  jobCount: number;
  /** Partners in the synthetic supply pool. */
  partnerCount: number;
  /** Share of partners who are ONLINE at any moment. */
  onlineRate: number;
  /** Share of partners who opted into emergency work. */
  emergencyOptInRate: number;
  /** Share of offers a partner accepts when asked (drives ring escalation). */
  acceptProbability: number;
  /** Spread of partners and jobs around a zone centre, in degrees (~1 km ≈ .009). */
  spreadDegrees: number;
  tierMix: { E0: number; E1: number };
  /**
   * Window over which the jobs arrive. Without this the simulation is not a
   * simulation — every job would compete for the same instant of supply, every
   * partner would be permanently busy after one job, and the assignment rate
   * would just measure `partnerCount / jobCount`.
   */
  simulationHours: number;
  /** How long a partner is occupied by one job, including travel. */
  jobDurationMinutes: { min: number; max: number };
}

export const BASELINE: ScenarioConfig = {
  seed: 20260729,
  // ~25 emergency jobs a day across three zones is a plausible early-stage
  // Bengaluru load; 300 over 12 days lets partners cycle properly.
  jobCount: 300,
  partnerCount: 60,
  onlineRate: 0.7,
  emergencyOptInRate: 0.6,
  acceptProbability: 0.45,
  spreadDegrees: 0.03, // roughly a 3 km radius around each zone centre
  tierMix: { E0: 0.35, E1: 0.65 },
  simulationHours: 12 * 24,
  jobDurationMinutes: { min: 60, max: 180 },
};

/** A job plus when it arrives and how long it will occupy a partner. */
export interface ScheduledJob {
  job: DispatchJob;
  /** Minutes from the start of the simulation. */
  arrivalMinute: number;
  durationMinutes: number;
}

export interface Scenario {
  partners: CandidatePartner[];
  /** Sorted by arrivalMinute ascending. */
  schedule: ScheduledJob[];
  /** Per-partner accept probability, used by the simulated offer loop. */
  acceptProbability: number;
  rng: Rng;
}

const TOOLS = ['DRAIN_MACHINE', 'JETTING_UNIT', 'CLOSET_AUGER', 'LEAK_DETECTOR', 'PPE_KIT'];
const TIERS: SkillTier[] = ['L1', 'L2', 'L3'];

export function buildScenario(config: ScenarioConfig): Scenario {
  const rng = createRng(config.seed);

  const partners: CandidatePartner[] = Array.from({ length: config.partnerCount }, (_, i) => {
    const zone = rng.pick(ZONES);
    // Weight towards L2 — that is the realistic shape of a plumbing supply pool.
    const skillTier = rng.chance(0.55) ? 'L2' : rng.pick(TIERS);
    return {
      partnerId: `sim_p${String(i).padStart(3, '0')}`,
      location: {
        lat: zone.lat + (rng.next() - 0.5) * config.spreadDegrees * 2,
        lng: zone.lng + (rng.next() - 0.5) * config.spreadDegrees * 2,
      },
      onlineStatus: rng.chance(config.onlineRate) ? 'ONLINE' : 'OFFLINE',
      skillTier,
      // Most partners cover 2 categories; a few are generalists.
      certifiedCategoryIds: rng.chance(0.2)
        ? [...CATEGORIES]
        : [rng.pick(CATEGORIES), rng.pick(CATEGORIES)],
      tools: TOOLS.filter(() => rng.chance(0.4)),
      activeJobCount: 0,
      emergencyOptIn: rng.chance(config.emergencyOptInRate),
      // Most partners sit comfortably above the 0.55 floor; some do not.
      acceptanceRate7d: rng.chance(0.85) ? 0.6 + rng.next() * 0.4 : rng.next() * 0.55,
      ratingAvg90d: rng.chance(0.1) ? null : 3.2 + rng.next() * 1.8,
      firstVisitResolutionRate: 0.6 + rng.next() * 0.4,
      categoryCompletions: rng.int(0, 60),
      jobsLast24h: rng.int(0, 5),
      openComplaints: rng.chance(0.08) ? 1 : 0,
      onStandby: rng.chance(0.15),
    };
  });

  const windowMinutes = config.simulationHours * 60;
  const schedule: ScheduledJob[] = Array.from({ length: config.jobCount }, (_, i) => {
    const zone = rng.pick(ZONES);
    const tier: UrgencyTier = rng.chance(config.tierMix.E0) ? 'E0' : 'E1';
    const requiredTools = rng.chance(0.3) ? [rng.pick(TOOLS)] : [];
    return {
      job: {
        jobId: `sim_j${String(i).padStart(4, '0')}`,
        location: {
          lat: zone.lat + (rng.next() - 0.5) * config.spreadDegrees * 2,
          lng: zone.lng + (rng.next() - 0.5) * config.spreadDegrees * 2,
        },
        urgencyTier: tier,
        categoryId: rng.pick(CATEGORIES),
        requiredSkillTier: rng.chance(0.5) ? 'L2' : rng.pick(TIERS),
        requiredTools,
        declinedBy: [],
      },
      arrivalMinute: rng.int(0, windowMinutes),
      durationMinutes: rng.int(config.jobDurationMinutes.min, config.jobDurationMinutes.max),
    };
  }).sort((a, b) => a.arrivalMinute - b.arrivalMinute);

  return { partners, schedule, acceptProbability: config.acceptProbability, rng };
}
