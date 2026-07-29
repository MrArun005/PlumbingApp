/**
 * The dispatch simulator.
 *
 * Replays synthetic emergency demand against a synthetic partner grid, walking
 * the real ring ladder and calling the real `rankCandidates`. This is where the
 * score weights get tuned — never in production, where you cannot A/B a burst
 * pipe.
 *
 * What it reports:
 *  - on-time %      : share of jobs assigned with an ETA inside the tier SLA
 *  - assignment %   : share assigned at all before the ladder ran out
 *  - mean/p90 ETA   : how long customers actually wait
 *  - fairness Gini  : 0 = every partner gets equal work, 1 = one partner gets all
 *  - ring histogram : which ring closed the job (ring 1 is cheap, ring 4 is a
 *                     human on the phone)
 */
import { rankCandidates } from '../rank';
import { ARRIVAL_SLA_MINUTES, ringsFor } from '../rings';
import type { CandidatePartner } from '../types';
import type { Scenario, ScheduledJob } from './scenario';

/**
 * A partner plus the simulation's view of when they are next free. Modelling
 * this is not optional: an earlier version marked partners busy and never freed
 * them, so after `partnerCount` jobs the entire pool was permanently occupied
 * and the "assignment rate" was really just partnerCount / jobCount. The
 * numbers looked catastrophic and meant nothing.
 */
interface SimPartner extends CandidatePartner {
  /** Minute in the simulation clock at which the current job ends. */
  busyUntilMinute: number;
  /** Arrival minutes of jobs taken, for the rolling 24 h fairness window. */
  takenAtMinutes: number[];
}

export interface JobOutcome {
  jobId: string;
  urgencyTier: string;
  assigned: boolean;
  /** Ring that produced the accepted offer, or null if never assigned. */
  ring: number | null;
  partnerId: string | null;
  etaMinutes: number | null;
  onTime: boolean;
  /** Offers sent across all rings — the cost of this assignment in pings. */
  offersSent: number;
}

export interface SimReport {
  jobCount: number;
  assignedCount: number;
  assignmentRate: number;
  onTimeCount: number;
  /** Of the ASSIGNED jobs, share whose ETA met the tier SLA. */
  onTimeRateOfAssigned: number;
  /** Of ALL jobs — the number the customer actually experiences. */
  onTimeRateOverall: number;
  meanEtaMinutes: number;
  p90EtaMinutes: number;
  fairnessGini: number;
  ringHistogram: Record<string, number>;
  totalOffersSent: number;
  outcomes: JobOutcome[];
}

/**
 * Smallest partner pool that reaches `targetOnTime` on an otherwise-unchanged
 * scenario. This is the simulator's most useful output: it converts a marketing
 * promise ("plumber in 30 minutes") into a recruitment number ("you need this
 * many plumbers per zone before you may advertise it").
 *
 * Returns null when even `maxPartners` cannot get there — which is itself the
 * answer: the SLA is not affordable under those conditions.
 */
export function minimumSupplyFor(
  targetOnTime: number,
  baseConfig: ScenarioConfigLike,
  buildFn: (c: ScenarioConfigLike) => Scenario,
  now: Date,
  { maxPartners = 400, step = 10 }: { maxPartners?: number; step?: number } = {},
): { partnerCount: number; report: SimReport } | null {
  for (let count = step; count <= maxPartners; count += step) {
    const report = simulate(buildFn({ ...baseConfig, partnerCount: count }), now);
    if (report.onTimeRateOverall >= targetOnTime) return { partnerCount: count, report };
  }
  return null;
}

/** Minimal shape needed by the sweep — avoids importing the full config type. */
export interface ScenarioConfigLike {
  partnerCount: number;
  [key: string]: unknown;
}

/**
 * Walk one job through the ring ladder. A partner accepts with probability
 * `acceptProbability`; decliners are recorded so they are never re-offered, and
 * an accepted job marks that partner busy for the rest of the run.
 */
function dispatchOne(
  scheduled: ScheduledJob,
  partners: SimPartner[],
  scenario: Scenario,
  now: Date,
): JobOutcome {
  const { job, arrivalMinute, durationMinutes } = scheduled;
  const declinedBy: string[] = [];
  let offersSent = 0;

  // Release partners whose previous job has finished by the time this one
  // arrives, and recompute the rolling 24-hour load that feeds fairness.
  for (const p of partners) {
    if (p.busyUntilMinute <= arrivalMinute) p.activeJobCount = 0;
    p.jobsLast24h = p.takenAtMinutes.filter((m) => arrivalMinute - m < 24 * 60).length;
  }

  const take = (p: SimPartner): void => {
    p.activeJobCount = 1;
    p.busyUntilMinute = arrivalMinute + durationMinutes;
    p.takenAtMinutes.push(arrivalMinute);
  };

  for (const ring of ringsFor(job.urgencyTier)) {
    // Ring 4 is the dispatcher desk: a human works the phone, and we model that
    // as a coin-flip on reaching anyone at all rather than as a ranked offer.
    if (ring.dispatcherDesk === true) {
      if (scenario.rng.chance(0.5)) {
        const fallback = partners.find(
          (p) =>
            p.onlineStatus === 'ONLINE' &&
            p.activeJobCount === 0 &&
            !declinedBy.includes(p.partnerId),
        );
        if (fallback !== undefined) {
          take(fallback);
          // A desk assignment has no ranked ETA; treat it as SLA-missed, which
          // is the honest reading — by ring 4 the clock has already run down.
          return {
            jobId: job.jobId,
            urgencyTier: job.urgencyTier,
            assigned: true,
            ring: ring.ring,
            partnerId: fallback.partnerId,
            etaMinutes: null,
            onTime: false,
            offersSent,
          };
        }
      }
      continue;
    }

    const pool =
      ring.includeStandbyPool === true
        ? partners
        : partners.filter((p) => p.onStandby !== true || ring.ring >= 3);

    const { offers } = rankCandidates({ ...job, declinedBy }, pool, ring, now);
    offersSent += offers.length;

    for (const offer of offers) {
      if (scenario.rng.chance(scenario.acceptProbability)) {
        const partner = partners.find((p) => p.partnerId === offer.partnerId);
        if (partner !== undefined) take(partner);
        const sla = ARRIVAL_SLA_MINUTES[job.urgencyTier];
        return {
          jobId: job.jobId,
          urgencyTier: job.urgencyTier,
          assigned: true,
          ring: ring.ring,
          partnerId: offer.partnerId,
          etaMinutes: offer.etaMinutes,
          onTime: sla === null ? true : offer.etaMinutes <= sla,
          offersSent,
        };
      }
      declinedBy.push(offer.partnerId);
    }
  }

  return {
    jobId: job.jobId,
    urgencyTier: job.urgencyTier,
    assigned: false,
    ring: null,
    partnerId: null,
    etaMinutes: null,
    onTime: false,
    offersSent,
  };
}

export function simulate(scenario: Scenario, now: Date): SimReport {
  // Clone partners so a scenario can be re-run without carrying over load.
  const partners: SimPartner[] = scenario.partners.map((p) => ({
    ...p,
    busyUntilMinute: 0,
    takenAtMinutes: [],
  }));
  // Jobs are processed in arrival order — that is what makes supply recycle.
  const outcomes = scenario.schedule.map((scheduled) =>
    dispatchOne(scheduled, partners, scenario, now),
  );

  const assigned = outcomes.filter((o) => o.assigned);
  const etas = assigned
    .map((o) => o.etaMinutes)
    .filter((e): e is number => e !== null)
    .sort((a, b) => a - b);

  // Fairness is measured over partners who COULD have been given work. Including
  // offline or non-emergency-opted-in partners would report a high Gini that
  // says nothing about dispatch behaviour — they were never candidates.
  const eligible = scenario.partners.filter((p) => p.onlineStatus === 'ONLINE');
  const jobsPerPartner = new Map<string, number>();
  for (const p of eligible) jobsPerPartner.set(p.partnerId, 0);
  for (const o of assigned) {
    if (o.partnerId !== null && jobsPerPartner.has(o.partnerId)) {
      jobsPerPartner.set(o.partnerId, (jobsPerPartner.get(o.partnerId) ?? 0) + 1);
    }
  }

  const ringHistogram: Record<string, number> = {};
  for (const o of outcomes) {
    const key = o.ring === null ? 'unassigned' : `ring${o.ring}`;
    ringHistogram[key] = (ringHistogram[key] ?? 0) + 1;
  }

  const onTimeCount = outcomes.filter((o) => o.onTime).length;

  return {
    jobCount: outcomes.length,
    assignedCount: assigned.length,
    assignmentRate: ratio(assigned.length, outcomes.length),
    onTimeCount,
    onTimeRateOfAssigned: ratio(onTimeCount, assigned.length),
    onTimeRateOverall: ratio(onTimeCount, outcomes.length),
    meanEtaMinutes: etas.length === 0 ? 0 : round2(etas.reduce((a, b) => a + b, 0) / etas.length),
    p90EtaMinutes: percentile(etas, 0.9),
    fairnessGini: gini([...jobsPerPartner.values()]),
    ringHistogram,
    totalOffersSent: outcomes.reduce((sum, o) => sum + o.offersSent, 0),
    outcomes,
  };
}

/**
 * Gini coefficient of work distribution. 0 = perfectly even, 1 = one partner
 * takes everything. Worth watching: a dispatch engine that always picks the same
 * five plumbers looks great on ETA and loses the rest of the supply pool.
 */
export function gini(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let weighted = 0;
  sorted.forEach((v, i) => {
    weighted += (i + 1) * v;
  });
  const n = sorted.length;
  return round4((2 * weighted) / (n * total) - (n + 1) / n);
}

export function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.ceil(p * sortedAsc.length) - 1);
  return round2(sortedAsc[Math.max(0, idx)] ?? 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round4(numerator / denominator);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
