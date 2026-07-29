/**
 * Job lifecycle — the on-site half of a booking, and where the anti-dispute
 * and worker-safety guards actually bite.
 *
 * Guards implemented literally from BUILD-PROMPT:
 *  - ARRIVED   requires geofence within 100 m AND a valid startOtp
 *  - IN_PROGRESS requires an approved quote if a quote exists
 *  - IN_PROGRESS is HARD BLOCKED on sewer/manhole work without PPE photo proof
 *    (manual entry into sewers is illegal in India — this is a block, not a
 *    policy note)
 *  - WORK_DONE requires ≥1 AFTER photo when the value exceeds ₹1,000
 *  - COMPLETED requires a valid endOtp and a settled or cash-marked payment
 */
import { ConflictError, ForbiddenError } from '../errors';
import type { Money } from '../money';
import { StateMachine, type Transition } from './machine';

export const JOB_STATES = [
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_PENDING',
  'QUOTE_REVISED',
  'VISIT_CHARGE_ONLY',
  'IN_PROGRESS',
  'WORK_DONE',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW_CUSTOMER',
  'NO_SHOW_PARTNER',
  'DISPUTED',
] as const;

export type JobState = (typeof JOB_STATES)[number];

/** Photo evidence is mandatory above this job value (₹1,000). */
export const AFTER_PHOTO_THRESHOLD_PAISE = 100_000n;

/** A partner must be within this distance of the address to mark ARRIVED. */
export const ARRIVAL_GEOFENCE_METRES = 100;

export interface JobContext {
  /** Straight-line metres between the partner's last ping and the address. */
  distanceToAddressM?: number;
  /** Did the OTP the partner typed match the job's startOtp? */
  startOtpValid?: boolean;
  /** Did the OTP the partner typed match the job's endOtp? */
  endOtpValid?: boolean;
  /** A Quote row exists for this job (of any status). */
  quoteExists?: boolean;
  /** That quote is APPROVED by the customer. */
  quoteApproved?: boolean;
  /**
   * The work involves a sewer, manhole or septic chamber. Machine-cleaning
   * only, PPE proof mandatory — no exceptions, ever.
   */
  isConfinedSpaceWork?: boolean;
  /** A MATERIAL_BILL/BEFORE photo proving PPE was worn has been uploaded. */
  ppePhotoUploaded?: boolean;
  /** Count of AFTER-phase photos on the job. */
  afterPhotoCount?: number;
  /** Final billable value, used for the photo threshold. */
  finalTotalPaise?: Money;
  /** Payment is CAPTURED, or the partner marked cash collected. */
  paymentSettled?: boolean;
}

const TERMINAL: JobState[] = [
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW_CUSTOMER',
  'NO_SHOW_PARTNER',
  'DISPUTED',
];

const LIVE_STATES: JobState[] = [
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_PENDING',
  'QUOTE_REVISED',
  'IN_PROGRESS',
  'WORK_DONE',
];

// ── guards ──────────────────────────────────────────────────────────────────

/** Proves the partner is physically at the address. Kills fake "arrived" taps. */
const requiresGeofence: (ctx: JobContext) => void = (ctx) => {
  const distance = ctx.distanceToAddressM;
  if (distance === undefined) {
    throw new ConflictError('We could not confirm your location. Turn location on and try again.', {
      reason: 'no_location',
    });
  }
  if (distance > ARRIVAL_GEOFENCE_METRES) {
    throw new ConflictError(
      `You need to be at the customer's address to check in (you are about ${Math.round(distance)} m away).`,
      { distanceToAddressM: Math.round(distance), limitM: ARRIVAL_GEOFENCE_METRES },
    );
  }
};

/** The customer reads a 4-digit code to the partner — proof of arrival. */
const requiresStartOtp: (ctx: JobContext) => void = (ctx) => {
  if (ctx.startOtpValid !== true) {
    throw new ForbiddenError('That start code is not correct. Ask the customer to read it again.');
  }
};

/** Work cannot begin on an unapproved quote. */
const requiresQuoteApprovalIfQuoted: (ctx: JobContext) => void = (ctx) => {
  if (ctx.quoteExists === true && ctx.quoteApproved !== true) {
    throw new ConflictError(
      'The customer has not approved the quote yet. Work cannot start until they do.',
      { reason: 'quote_not_approved' },
    );
  }
};

/**
 * HARD BLOCK. Manual scavenging is illegal in India; sewer and manhole work is
 * machine-based only and requires photographic proof that PPE was worn before
 * any work begins. This is deliberately not overridable.
 */
const requiresPpeProofForConfinedSpace: (ctx: JobContext) => void = (ctx) => {
  if (ctx.isConfinedSpaceWork === true && ctx.ppePhotoUploaded !== true) {
    throw new ForbiddenError(
      'Sewer and manhole work needs a photo showing your PPE before you can start. This is a legal requirement and cannot be skipped.',
      { reason: 'ppe_proof_required' },
    );
  }
};

/** Photo evidence above ₹1,000 — the cheapest dispute insurance there is. */
const requiresAfterPhotoAboveThreshold: (ctx: JobContext) => void = (ctx) => {
  const total = ctx.finalTotalPaise;
  if (total !== undefined && total > AFTER_PHOTO_THRESHOLD_PAISE) {
    if ((ctx.afterPhotoCount ?? 0) < 1) {
      throw new ConflictError(
        'Add at least one photo of the finished work before marking this job done.',
        { reason: 'after_photo_required' },
      );
    }
  }
};

const requiresEndOtp: (ctx: JobContext) => void = (ctx) => {
  if (ctx.endOtpValid !== true) {
    throw new ForbiddenError(
      'That completion code is not correct. Ask the customer to read it again.',
    );
  }
};

const requiresSettledPayment: (ctx: JobContext) => void = (ctx) => {
  if (ctx.paymentSettled !== true) {
    throw new ConflictError('Collect payment (or mark cash collected) before closing the job.');
  }
};

// ── transitions ─────────────────────────────────────────────────────────────

const happyPath: Transition<JobState, JobContext>[] = [
  { from: 'ASSIGNED', to: 'EN_ROUTE' },
  { from: 'EN_ROUTE', to: 'ARRIVED', guards: [requiresGeofence, requiresStartOtp] },
  { from: 'ARRIVED', to: 'DIAGNOSING' },
  { from: 'DIAGNOSING', to: 'QUOTE_PENDING' },
  { from: 'QUOTE_PENDING', to: 'QUOTE_REVISED' },
  { from: 'QUOTE_REVISED', to: 'QUOTE_PENDING' },
  {
    from: 'DIAGNOSING',
    to: 'IN_PROGRESS',
    guards: [requiresQuoteApprovalIfQuoted, requiresPpeProofForConfinedSpace],
  },
  {
    from: 'QUOTE_PENDING',
    to: 'IN_PROGRESS',
    guards: [requiresQuoteApprovalIfQuoted, requiresPpeProofForConfinedSpace],
  },
  {
    from: 'QUOTE_REVISED',
    to: 'IN_PROGRESS',
    guards: [requiresQuoteApprovalIfQuoted, requiresPpeProofForConfinedSpace],
  },
  { from: 'QUOTE_PENDING', to: 'VISIT_CHARGE_ONLY' },
  { from: 'QUOTE_REVISED', to: 'VISIT_CHARGE_ONLY' },
  { from: 'IN_PROGRESS', to: 'WORK_DONE', guards: [requiresAfterPhotoAboveThreshold] },
  { from: 'WORK_DONE', to: 'COMPLETED', guards: [requiresEndOtp, requiresSettledPayment] },
  // Declined quote: only the visit charge is due, then the job closes.
  { from: 'VISIT_CHARGE_ONLY', to: 'COMPLETED', guards: [requiresSettledPayment] },
];

const sideStates: Transition<JobState, JobContext>[] = LIVE_STATES.flatMap((from) =>
  (['CANCELLED', 'NO_SHOW_CUSTOMER', 'NO_SHOW_PARTNER', 'DISPUTED'] as const).map((to) => ({
    from,
    to,
  })),
);

export const jobMachine = new StateMachine<JobState, JobContext>(
  'Job',
  [...happyPath, ...sideStates],
  TERMINAL,
);

/**
 * A quote this far above the booking estimate needs explicit customer approval
 * AND raises an admin review flag (BUILD-PROMPT: >30%).
 */
export const QUOTE_ADMIN_REVIEW_RATIO_PCT = 130n;

export function quoteNeedsAdminReview(estimatePaise: Money, quotePaise: Money): boolean {
  // Nothing to compare against on an inspect-first booking (estimate is zero),
  // so the >30% rule cannot apply — the quote IS the first price.
  if (estimatePaise <= 0n) return false;
  return quotePaise * 100n > estimatePaise * QUOTE_ADMIN_REVIEW_RATIO_PCT;
}
