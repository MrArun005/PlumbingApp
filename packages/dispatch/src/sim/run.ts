/* eslint-disable no-console -- CLI reporting tool, not runtime code */
/**
 * Simulator CLI:  pnpm --filter @pipefix/dispatch sim
 *
 * Runs the baseline scenario plus a few supply variations, so the numbers are
 * read as a curve rather than as a single figure. Use this to tune the score
 * weights in `rank.ts` — and note which knob actually moved the needle, because
 * on-time rate is dominated by SUPPLY, not by ranking cleverness.
 */
import { BASELINE, buildScenario, type ScenarioConfig } from './scenario';
import { minimumSupplyFor, simulate, type SimReport } from './simulate';

/** The E0 on-time target the platform advertises (BUILD-PROMPT WO-09). */
const TARGET_ON_TIME = 0.85;

const NOW = new Date('2026-07-29T10:00:00Z');

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function row(label: string, r: SimReport): string {
  return [
    label.padEnd(26),
    pct(r.assignmentRate).padStart(8),
    pct(r.onTimeRateOverall).padStart(9),
    `${r.meanEtaMinutes.toFixed(1)}m`.padStart(8),
    `${r.p90EtaMinutes.toFixed(1)}m`.padStart(8),
    r.fairnessGini.toFixed(3).padStart(8),
    String(r.totalOffersSent).padStart(8),
  ].join('');
}

function main(): void {
  const variants: { label: string; config: ScenarioConfig }[] = [
    { label: 'baseline', config: BASELINE },
    { label: 'thin supply (30 partners)', config: { ...BASELINE, partnerCount: 30 } },
    { label: 'rich supply (120)', config: { ...BASELINE, partnerCount: 120 } },
    { label: 'low online rate (.4)', config: { ...BASELINE, onlineRate: 0.4 } },
    { label: 'eager partners (.7 accept)', config: { ...BASELINE, acceptProbability: 0.7 } },
    { label: 'reluctant (.25 accept)', config: { ...BASELINE, acceptProbability: 0.25 } },
    { label: 'demand spike (900 jobs)', config: { ...BASELINE, jobCount: 900 } },
  ];

  console.log('\nPipeFix dispatch simulation — emergency tiers (E0 ≤30min, E1 ≤2h)\n');
  console.log(
    [
      'scenario'.padEnd(26),
      'assigned'.padStart(8),
      'on-time'.padStart(9),
      'mean'.padStart(8),
      'p90'.padStart(8),
      'gini'.padStart(8),
      'offers'.padStart(8),
    ].join(''),
  );
  console.log('-'.repeat(76));

  let baselineReport: SimReport | null = null;
  for (const { label, config } of variants) {
    const report = simulate(buildScenario(config), NOW);
    if (label === 'baseline') baselineReport = report;
    console.log(row(label, report));
  }

  if (baselineReport !== null) {
    console.log('\nBaseline ring breakdown (which ring closed the job):');
    for (const [ring, count] of Object.entries(baselineReport.ringHistogram).sort()) {
      const share = pct(count / baselineReport.jobCount);
      console.log(`  ${ring.padEnd(12)} ${String(count).padStart(4)}  ${share.padStart(7)}`);
    }
    console.log(
      `\nBaseline on-time (of assigned): ${pct(baselineReport.onTimeRateOfAssigned)}` +
        `  ·  overall: ${pct(baselineReport.onTimeRateOverall)}`,
    );
    console.log(
      '\nRead this as: on-time rate tracks SUPPLY far more than ranking weights.\n' +
        'Compare the thin-supply and rich-supply rows before touching rank.ts.',
    );
  }

  // The headline number: what supply does the advertised SLA actually cost?
  const found = minimumSupplyFor(
    TARGET_ON_TIME,
    BASELINE as unknown as Record<string, unknown> & { partnerCount: number },
    (c) => buildScenario(c as unknown as ScenarioConfig),
    NOW,
  );

  console.log(`\n── Supply required for ${pct(TARGET_ON_TIME)} on-time ──`);
  if (found === null) {
    console.log(
      `  Not reachable below 400 partners under these conditions.\n` +
        `  That is the finding: do NOT advertise this SLA until the inputs change.`,
    );
  } else {
    console.log(
      `  ${found.partnerCount} partners across 3 zones -> ${pct(found.report.onTimeRateOverall)} on-time,\n` +
        `  ${pct(found.report.assignmentRate)} assigned, p90 ETA ${found.report.p90EtaMinutes.toFixed(1)}m.\n` +
        `  Baseline (${BASELINE.partnerCount} partners) reaches only ` +
        `${pct(baselineReport?.onTimeRateOverall ?? 0)} — so the 30-minute promise is a\n` +
        `  RECRUITMENT target, not a software one. Per PLAN §3.5, do not advertise a\n` +
        `  zone until its own coverage supports it.`,
    );
  }
  console.log();
}

main();
