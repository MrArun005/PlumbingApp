/**
 * Safety scripts — the instructions shown to a customer BEFORE any plumber is
 * assigned ("close the main stopcock", "switch off the geyser MCB first").
 *
 * THE HARD RULE: a script without `reviewedAt` has not been signed off by a
 * licensed plumber, and must never reach a real user. Bad safety advice during
 * a live electrical-and-water hazard can injure someone. So in production an
 * unreviewed script is not rendered — the customer gets a conservative
 * fallback and dispatch continues unaffected.
 *
 * Outside production the draft IS served, clearly marked, so the flow is
 * testable. That asymmetry is deliberate and is covered by tests.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type pino from 'pino';
import { ENV, LOGGER, PRISMA, type ApiEnv } from '../env';

export type EmergencyIssueType =
  | 'BURST_PIPE'
  | 'FLOODING'
  | 'SEWAGE_BACKFLOW'
  | 'NO_WATER'
  | 'GEYSER_LEAK'
  | 'TANK_OVERFLOW'
  | 'GAS_SMELL'
  | 'OTHER';

export interface SafetyCard {
  issueType: string;
  /** Version recorded on the EmergencyRequest for audit. 0 = fallback. */
  version: number;
  title: string;
  bodyMarkdown: string;
  illustrationKeys: string[];
  /** False when the expert-reviewed copy was withheld. */
  isExpertReviewed: boolean;
  /**
   * Set when a licensed plumber must still author this content. Surfaced to ops
   * dashboards — an emergency tier running on fallback copy is a launch blocker.
   */
  pendingExpertReview: boolean;
}

/**
 * Conservative advice used when no reviewed script exists. Deliberately says
 * almost nothing beyond "make yourself safe and wait" — the whole point is not
 * to invent plumbing instructions.
 */
const FALLBACK_BODY = [
  'Your request is on its way to a plumber right now.',
  '',
  'While you wait, if you can do so safely:',
  '',
  '- Turn off the water at the main stopcock if you know where it is.',
  '- Keep away from any water that is near sockets, switches or appliances.',
  '- Do not touch electrical fittings that are wet.',
  '',
  'If anyone is in danger, or you smell gas, leave the property and call the',
  'emergency services first.',
].join('\n');

const TITLES: Record<string, string> = {
  BURST_PIPE: 'Burst pipe — do this first',
  FLOODING: 'Flooding — do this first',
  SEWAGE_BACKFLOW: 'Sewage backflow — do this first',
  NO_WATER: 'No water supply — while you wait',
  GEYSER_LEAK: 'Leaking geyser — electrical hazard',
  TANK_OVERFLOW: 'Tank overflowing — do this first',
  GAS_SMELL: 'Gas smell — leave the property',
  OTHER: 'While you wait',
};

@Injectable()
export class SafetyScriptsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  async cardFor(issueType: string): Promise<SafetyCard> {
    // Highest version wins; a newer draft supersedes an older draft.
    const script = await this.prisma.safetyScript.findFirst({
      where: { issueType },
      orderBy: { version: 'desc' },
    });

    const title = TITLES[issueType] ?? TITLES['OTHER'] ?? 'While you wait';

    if (script === null) {
      this.logger.warn({ event: 'safety.script_missing', issueType });
      return this.fallback(issueType, title, true);
    }

    const reviewed = script.reviewedAt !== null;

    if (!reviewed && this.env.NODE_ENV === 'production') {
      // Hard block. Never serve unreviewed safety advice to a real customer.
      this.logger.error({
        event: 'safety.unreviewed_script_withheld',
        issueType,
        version: script.version,
        scriptId: script.id,
      });
      return this.fallback(issueType, title, true);
    }

    if (!reviewed) {
      this.logger.warn({
        event: 'safety.serving_unreviewed_draft_non_production',
        issueType,
        version: script.version,
      });
    }

    return {
      issueType,
      version: script.version,
      title,
      bodyMarkdown: script.bodyMarkdown,
      illustrationKeys: script.illustrationKeys,
      isExpertReviewed: reviewed,
      pendingExpertReview: !reviewed,
    };
  }

  private fallback(issueType: string, title: string, pending: boolean): SafetyCard {
    return {
      issueType,
      version: 0,
      title,
      bodyMarkdown: FALLBACK_BODY,
      illustrationKeys: [],
      isExpertReviewed: false,
      pendingExpertReview: pending,
    };
  }

  /**
   * Launch-readiness check for the ops dashboard: which emergency issue types
   * still lack expert-reviewed copy. A non-empty list blocks advertising the
   * emergency tier.
   */
  async unreviewedIssueTypes(): Promise<string[]> {
    const scripts = await this.prisma.safetyScript.findMany({
      orderBy: [{ issueType: 'asc' }, { version: 'desc' }],
    });
    const latestByType = new Map<string, (typeof scripts)[number]>();
    for (const s of scripts) {
      if (!latestByType.has(s.issueType)) latestByType.set(s.issueType, s);
    }
    return [...latestByType.values()]
      .filter((s) => s.reviewedAt === null)
      .map((s) => s.issueType)
      .sort();
  }
}
