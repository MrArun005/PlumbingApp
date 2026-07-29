import { describe, expect, it, vi } from 'vitest';
import { estimateEtaMinutes, haversineMeters } from './geo';
import { MIN_ACCEPTANCE_RATE_7D, rankCandidates } from './rank';
import { E0_GUARANTEE_SECONDS, ladderDurationSeconds, ringsFor } from './rings';
import type { CandidatePartner, DispatchJob, RingConfig } from './types';

const NOW = new Date('2026-07-29T10:00:00Z');

// Koramangala, Bengaluru.
const JOB_AT = { lat: 12.934, lng: 77.622 };

const RING_1: RingConfig = {
  ring: 1,
  radiusMeters: 3_000,
  topN: 5,
  windowSeconds: 45,
  maxEtaMinutes: 20,
};

function job(overrides: Partial<DispatchJob> = {}): DispatchJob {
  return {
    jobId: 'job_1',
    location: JOB_AT,
    urgencyTier: 'E0',
    categoryId: 'cat_leak',
    requiredSkillTier: 'L2',
    requiredTools: [],
    declinedBy: [],
    ...overrides,
  };
}

/** A partner who passes every filter, ~500 m from the job. */
function partner(id: string, overrides: Partial<CandidatePartner> = {}): CandidatePartner {
  return {
    partnerId: id,
    location: { lat: 12.9385, lng: 77.622 },
    onlineStatus: 'ONLINE',
    skillTier: 'L2',
    certifiedCategoryIds: ['cat_leak'],
    tools: [],
    activeJobCount: 0,
    emergencyOptIn: true,
    acceptanceRate7d: 0.9,
    ratingAvg90d: 4.5,
    firstVisitResolutionRate: 0.8,
    categoryCompletions: 20,
    jobsLast24h: 1,
    openComplaints: 0,
    ...overrides,
  };
}

describe('filters — every one must pass', () => {
  it('accepts a fully eligible partner', () => {
    const { offers, excluded } = rankCandidates(job(), [partner('p1')], RING_1, NOW);
    expect(offers).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  it('excludes an offline partner', () => {
    const { offers, excluded } = rankCandidates(
      job(),
      [partner('p1', { onlineStatus: 'OFFLINE' })],
      RING_1,
      NOW,
    );
    expect(offers).toHaveLength(0);
    expect(excluded[0]?.reason).toBe('OFFLINE');
  });

  it('excludes a partner already on a job for emergency tiers', () => {
    const { excluded } = rankCandidates(
      job({ urgencyTier: 'E0' }),
      [partner('p1', { activeJobCount: 1, onlineStatus: 'ONLINE' })],
      RING_1,
      NOW,
    );
    expect(excluded[0]?.reason).toBe('ALREADY_ON_JOB');
  });

  it('ALLOWS a busy partner for scheduled tiers (they get batched)', () => {
    const { offers } = rankCandidates(
      job({ urgencyTier: 'E3' }),
      [partner('p1', { activeJobCount: 2 })],
      RING_1,
      NOW,
    );
    expect(offers).toHaveLength(1);
  });

  it('excludes a partner whose skill tier is too low', () => {
    const { excluded } = rankCandidates(
      job({ requiredSkillTier: 'L3' }),
      [partner('p1', { skillTier: 'L2' })],
      RING_1,
      NOW,
    );
    expect(excluded[0]?.reason).toBe('SKILL_TIER_TOO_LOW');
  });

  it('allows a higher skill tier than required', () => {
    const { offers } = rankCandidates(
      job({ requiredSkillTier: 'L2' }),
      [partner('p1', { skillTier: 'L3' })],
      RING_1,
      NOW,
    );
    expect(offers).toHaveLength(1);
  });

  it('excludes a partner not certified for the category', () => {
    const { excluded } = rankCandidates(
      job({ categoryId: 'cat_drain' }),
      [partner('p1', { certifiedCategoryIds: ['cat_leak'] })],
      RING_1,
      NOW,
    );
    expect(excluded[0]?.reason).toBe('NOT_CERTIFIED_FOR_CATEGORY');
  });

  it('excludes a partner missing a required tool', () => {
    const { excluded } = rankCandidates(
      job({ requiredTools: ['JETTING_UNIT', 'PPE_KIT'] }),
      [partner('p1', { tools: ['JETTING_UNIT'] })],
      RING_1,
      NOW,
    );
    expect(excluded[0]?.reason).toBe('MISSING_TOOLS');
  });

  it('accepts a partner carrying more tools than required', () => {
    const { offers } = rankCandidates(
      job({ requiredTools: ['PPE_KIT'] }),
      [partner('p1', { tools: ['PPE_KIT', 'JETTING_UNIT', 'CORE_DRILL'] })],
      RING_1,
      NOW,
    );
    expect(offers).toHaveLength(1);
  });

  it('excludes a partner outside the ring radius', () => {
    // Whitefield is ~15 km from Koramangala.
    const { excluded } = rankCandidates(
      job(),
      [partner('p1', { location: { lat: 12.97, lng: 77.75 } })],
      RING_1,
      NOW,
    );
    expect(excluded[0]?.reason).toBe('OUTSIDE_RING_RADIUS');
  });

  it('requires emergency opt-in for E0 but not for E1', () => {
    const notOptedIn = [partner('p1', { emergencyOptIn: false })];
    expect(
      rankCandidates(job({ urgencyTier: 'E0' }), notOptedIn, RING_1, NOW).excluded[0]?.reason,
    ).toBe('NOT_EMERGENCY_OPTED_IN');
    expect(rankCandidates(job({ urgencyTier: 'E1' }), notOptedIn, RING_1, NOW).offers).toHaveLength(
      1,
    );
  });

  it('never re-offers to a partner who already declined', () => {
    const { excluded } = rankCandidates(job({ declinedBy: ['p1'] }), [partner('p1')], RING_1, NOW);
    expect(excluded[0]?.reason).toBe('ALREADY_DECLINED');
  });

  it('excludes a partner below the acceptance-rate floor', () => {
    const { excluded } = rankCandidates(
      job(),
      [partner('p1', { acceptanceRate7d: 0.4 })],
      RING_1,
      NOW,
    );
    expect(excluded[0]?.reason).toBe('ACCEPTANCE_RATE_TOO_LOW');
  });

  it('accepts a partner exactly at the acceptance floor', () => {
    const { offers } = rankCandidates(
      job(),
      [partner('p1', { acceptanceRate7d: MIN_ACCEPTANCE_RATE_7D })],
      RING_1,
      NOW,
    );
    expect(offers).toHaveLength(1);
  });

  it('reports one exclusion per rejected partner', () => {
    const { offers, excluded } = rankCandidates(
      job(),
      [
        partner('ok'),
        partner('offline', { onlineStatus: 'OFFLINE' }),
        partner('lowaccept', { acceptanceRate7d: 0.1 }),
      ],
      RING_1,
      NOW,
    );
    expect(offers.map((o) => o.partnerId)).toEqual(['ok']);
    expect(excluded).toHaveLength(2);
  });
});

describe('scoring', () => {
  it('prefers the nearer partner, all else equal', () => {
    const near = partner('near', { location: { lat: 12.9345, lng: 77.622 } });
    const far = partner('far', { location: { lat: 12.955, lng: 77.622 } });
    const { offers } = rankCandidates(job(), [far, near], RING_1, NOW);
    expect(offers[0]?.partnerId).toBe('near');
    expect(offers[0]?.etaMinutes).toBeLessThan(offers[1]?.etaMinutes ?? Infinity);
  });

  it('prefers the better-rated partner at equal distance', () => {
    const good = partner('good', { ratingAvg90d: 4.9 });
    const poor = partner('poor', { ratingAvg90d: 3.0 });
    const { offers } = rankCandidates(job(), [poor, good], RING_1, NOW);
    expect(offers[0]?.partnerId).toBe('good');
  });

  it('penalises an open complaint heavily', () => {
    const clean = partner('clean');
    const flagged = partner('flagged', { openComplaints: 2, ratingAvg90d: 5 });
    const { offers } = rankCandidates(job(), [flagged, clean], RING_1, NOW);
    expect(offers[0]?.partnerId).toBe('clean');
    expect(offers.find((o) => o.partnerId === 'flagged')?.scoreBreakdown.complaintPenalty).toBe(
      0.2,
    );
  });

  it('gives an idle partner a fairness boost over a busy one', () => {
    const idle = partner('idle', { jobsLast24h: 0 });
    const busy = partner('busy', { jobsLast24h: 7 });
    const { offers } = rankCandidates(job(), [busy, idle], RING_1, NOW);
    expect(offers[0]?.partnerId).toBe('idle');
    const idleBoost = offers.find((o) => o.partnerId === 'idle')?.scoreBreakdown.fairness ?? 0;
    const busyBoost = offers.find((o) => o.partnerId === 'busy')?.scoreBreakdown.fairness ?? 0;
    expect(idleBoost).toBeGreaterThan(busyBoost);
  });

  it('treats an unrated partner as average rather than as bad', () => {
    const unrated = partner('unrated', { ratingAvg90d: null });
    const bad = partner('bad', { ratingAvg90d: 1.5 });
    const { offers } = rankCandidates(job(), [bad, unrated], RING_1, NOW);
    expect(offers[0]?.partnerId).toBe('unrated');
  });

  it('rewards category experience up to saturation, then stops', () => {
    const experienced = partner('exp', { categoryCompletions: 25 });
    const veteran = partner('vet', { categoryCompletions: 500 });
    const { offers } = rankCandidates(job(), [experienced, veteran], RING_1, NOW);
    const a = offers.find((o) => o.partnerId === 'exp')?.scoreBreakdown.categoryExperience;
    const b = offers.find((o) => o.partnerId === 'vet')?.scoreBreakdown.categoryExperience;
    expect(a).toBe(b); // saturated — volume beyond 25 is not extra credit
  });

  it('never lets a slow partner score negatively on the ETA term', () => {
    const veryFar = partner('slow', { location: { lat: 12.9585, lng: 77.622 } });
    const { offers } = rankCandidates(job(), [veryFar], RING_1, NOW);
    expect(offers[0]?.scoreBreakdown.eta).toBeGreaterThanOrEqual(0);
  });

  it('caps the offer list at the ring topN', () => {
    const many = Array.from({ length: 12 }, (_, i) => partner(`p${i}`));
    const { offers } = rankCandidates(job(), many, RING_1, NOW);
    expect(offers).toHaveLength(5);
  });

  it('exposes every score term for the ops board', () => {
    const { offers } = rankCandidates(job(), [partner('p1')], RING_1, NOW);
    expect(Object.keys(offers[0]?.scoreBreakdown ?? {}).sort()).toEqual([
      'categoryExperience',
      'complaintPenalty',
      'eta',
      'fairness',
      'firstVisitResolution',
      'rating',
    ]);
  });
});

describe('determinism — the simulator depends on it', () => {
  it('produces identical output for identical input', () => {
    const candidates = [partner('a'), partner('b'), partner('c')];
    const first = rankCandidates(job(), candidates, RING_1, NOW);
    const second = rankCandidates(job(), candidates, RING_1, NOW);
    expect(second).toEqual(first);
  });

  it('breaks exact ties by partnerId, not by input order', () => {
    const a = partner('aaa');
    const b = partner('bbb');
    const forwards = rankCandidates(job(), [a, b], RING_1, NOW);
    const backwards = rankCandidates(job(), [b, a], RING_1, NOW);
    expect(forwards.offers.map((o) => o.partnerId)).toEqual(['aaa', 'bbb']);
    expect(backwards.offers.map((o) => o.partnerId)).toEqual(['aaa', 'bbb']);
  });

  it('consults neither the clock nor the RNG', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('dispatch must not read the clock');
    });
    const rndSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('dispatch must not use Math.random');
    });
    try {
      expect(() => rankCandidates(job(), [partner('p1')], RING_1, NOW)).not.toThrow();
    } finally {
      nowSpy.mockRestore();
      rndSpy.mockRestore();
    }
  });
});

describe('rings', () => {
  it('E0 escalates 3 km → 6 km → 10 km + standby → dispatcher desk', () => {
    const rings = ringsFor('E0');
    expect(rings.map((r) => r.radiusMeters)).toEqual([3_000, 6_000, 10_000, 10_000]);
    expect(rings.map((r) => r.topN)).toEqual([5, 8, 12, 0]);
    expect(rings[2]?.includeStandbyPool).toBe(true);
    expect(rings[3]?.dispatcherDesk).toBe(true);
  });

  it('E1 uses the same radii with 90-second windows', () => {
    const e1 = ringsFor('E1');
    expect(e1.slice(0, 3).map((r) => r.windowSeconds)).toEqual([90, 90, 90]);
    expect(e1.map((r) => r.radiusMeters)).toEqual(ringsFor('E0').map((r) => r.radiusMeters));
  });

  it('the E0 ladder finishes inside the 10-minute guarantee window', () => {
    expect(ladderDurationSeconds('E0')).toBeLessThanOrEqual(E0_GUARANTEE_SECONDS);
  });

  it('scheduled tiers use one wide ring, not a race', () => {
    expect(ringsFor('E2')).toHaveLength(1);
    expect(ringsFor('E3')).toHaveLength(1);
  });

  it('the dispatcher desk ring makes no automated offers', () => {
    const desk = ringsFor('E0')[3];
    if (desk === undefined) throw new Error('expected a ring 4');
    const { offers, excluded } = rankCandidates(job(), [partner('p1')], desk, NOW);
    expect(offers).toHaveLength(0);
    expect(excluded).toHaveLength(0);
  });
});

describe('geo', () => {
  it('measures a known Bengaluru distance about right', () => {
    // Koramangala → Indiranagar is roughly 5 km.
    const m = haversineMeters(JOB_AT, { lat: 12.978, lng: 77.641 });
    expect(m).toBeGreaterThan(4_000);
    expect(m).toBeLessThan(6_500);
  });

  it('is zero for the same point and symmetric', () => {
    expect(haversineMeters(JOB_AT, JOB_AT)).toBe(0);
    const a = { lat: 12.9, lng: 77.6 };
    const b = { lat: 13.0, lng: 77.7 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });

  it('ETA includes fixed overhead, so a doorstep job is not instant', () => {
    expect(estimateEtaMinutes(0)).toBeGreaterThan(0);
  });

  it('ETA rises with distance', () => {
    expect(estimateEtaMinutes(5_000)).toBeGreaterThan(estimateEtaMinutes(1_000));
  });
});
