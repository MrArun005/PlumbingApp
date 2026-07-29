import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { BASELINE, buildScenario, type ScenarioConfig } from './scenario';
import { gini, minimumSupplyFor, percentile, simulate } from './simulate';

const NOW = new Date('2026-07-29T10:00:00Z');

describe('seeded RNG', () => {
  it('is reproducible for a given seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('differs across seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });

  it('stays inside [0,1) and honours int bounds', () => {
    const rng = createRng(7);
    for (let i = 0; i < 200; i += 1) {
      const n = rng.next();
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
      const k = rng.int(3, 5);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThanOrEqual(5);
    }
  });

  it('throws rather than returning undefined on an empty pick', () => {
    expect(() => createRng(1).pick([])).toThrow();
  });
});

describe('gini', () => {
  it('is 0 when work is spread perfectly evenly', () => {
    expect(gini([5, 5, 5, 5])).toBe(0);
  });

  it('approaches 1 when one partner takes everything', () => {
    expect(gini([0, 0, 0, 100])).toBeGreaterThan(0.7);
  });

  it('handles empty input and all-zero input', () => {
    expect(gini([])).toBe(0);
    expect(gini([0, 0, 0])).toBe(0);
  });
});

describe('percentile', () => {
  it('picks the p90 of a sorted series', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });

  it('returns 0 for an empty series', () => {
    expect(percentile([], 0.9)).toBe(0);
  });
});

describe('scenario generation', () => {
  it('is fully determined by the seed', () => {
    const a = buildScenario(BASELINE);
    const b = buildScenario(BASELINE);
    expect(b.partners).toEqual(a.partners);
    expect(b.schedule.map((s) => s.job.jobId)).toEqual(a.schedule.map((s) => s.job.jobId));
  });

  it('spreads job arrivals across the simulation window in order', () => {
    const { schedule } = buildScenario(BASELINE);
    const arrivals = schedule.map((s) => s.arrivalMinute);
    expect(arrivals).toEqual([...arrivals].sort((x, y) => x - y));
    expect(arrivals[arrivals.length - 1]).toBeGreaterThan(0);
  });
});

describe('simulate', () => {
  it('produces the same report for the same scenario', () => {
    const first = simulate(buildScenario(BASELINE), NOW);
    const second = simulate(buildScenario(BASELINE), NOW);
    expect(second.onTimeRateOverall).toBe(first.onTimeRateOverall);
    expect(second.assignedCount).toBe(first.assignedCount);
    expect(second.fairnessGini).toBe(first.fairnessGini);
  });

  it('accounts for every job exactly once', () => {
    const report = simulate(buildScenario(BASELINE), NOW);
    expect(report.outcomes).toHaveLength(BASELINE.jobCount);
    const histTotal = Object.values(report.ringHistogram).reduce((a, b) => a + b, 0);
    expect(histTotal).toBe(BASELINE.jobCount);
  });

  it('never reports on-time for an unassigned job', () => {
    const report = simulate(buildScenario(BASELINE), NOW);
    for (const o of report.outcomes) {
      if (!o.assigned) expect(o.onTime).toBe(false);
    }
  });

  /**
   * Regression: an earlier version marked a partner busy and never freed them,
   * so once every partner had taken one job the rest of the demand could never
   * be served. With 3x more jobs than partners, a working time model must still
   * assign well over one job per partner.
   */
  it('recycles supply over time instead of saturating permanently', () => {
    const config: ScenarioConfig = { ...BASELINE, partnerCount: 40, jobCount: 200 };
    const report = simulate(buildScenario(config), NOW);
    expect(report.assignedCount).toBeGreaterThan(config.partnerCount * 1.5);
  });

  it('serves more demand as supply grows', () => {
    const thin = simulate(buildScenario({ ...BASELINE, partnerCount: 30 }), NOW);
    const rich = simulate(buildScenario({ ...BASELINE, partnerCount: 120 }), NOW);
    expect(rich.onTimeRateOverall).toBeGreaterThan(thin.onTimeRateOverall);
    expect(rich.meanEtaMinutes).toBeLessThan(thin.meanEtaMinutes);
  });

  it('sends more offers when partners decline more often', () => {
    const eager = simulate(buildScenario({ ...BASELINE, acceptProbability: 0.8 }), NOW);
    const reluctant = simulate(buildScenario({ ...BASELINE, acceptProbability: 0.2 }), NOW);
    expect(reluctant.totalOffersSent).toBeGreaterThan(eager.totalOffersSent);
  });

  it('closes most jobs in the cheap early rings', () => {
    const report = simulate(buildScenario(BASELINE), NOW);
    const ring1 = report.ringHistogram['ring1'] ?? 0;
    const ring4 = report.ringHistogram['ring4'] ?? 0;
    // Ring 4 is a human on the phone; it must be the exception, not the norm.
    expect(ring1).toBeGreaterThan(ring4);
  });

  it('keeps ETAs plausible for a city the size of Bengaluru', () => {
    const report = simulate(buildScenario(BASELINE), NOW);
    expect(report.meanEtaMinutes).toBeGreaterThan(5);
    expect(report.meanEtaMinutes).toBeLessThan(60);
  });
});

describe('minimumSupplyFor — the WO-09 on-time criterion', () => {
  /**
   * The done-when criterion is ">=85% on-time on the baseline scenario". The
   * engine DOES reach it, but only with adequate supply — the baseline pool of
   * 60 partners does not. That is the finding, not a failure: emergency SLAs are
   * a supply problem (PLAN §3.5), and this is the number that says how much
   * supply. Tuning the scenario until 60 partners "passed" would be gaming it.
   */
  it('reaches 85% on-time with a large enough partner pool', () => {
    const found = minimumSupplyFor(
      0.85,
      BASELINE as unknown as Record<string, unknown> & { partnerCount: number },
      (c) => buildScenario(c as unknown as ScenarioConfig),
      NOW,
    );
    expect(found).not.toBeNull();
    expect(found?.report.onTimeRateOverall).toBeGreaterThanOrEqual(0.85);
    // Sanity: it should need MORE than the baseline pool, or the baseline would
    // already have passed and this test would be proving nothing.
    expect(found?.partnerCount).toBeGreaterThan(BASELINE.partnerCount);
  });

  it('returns null when the target is unreachable', () => {
    const found = minimumSupplyFor(
      0.999,
      { ...BASELINE, onlineRate: 0.05, acceptProbability: 0.02 } as unknown as Record<
        string,
        unknown
      > & { partnerCount: number },
      (c) => buildScenario(c as unknown as ScenarioConfig),
      NOW,
      { maxPartners: 40, step: 20 },
    );
    expect(found).toBeNull();
  });
});
