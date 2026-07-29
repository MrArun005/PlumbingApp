import { describe, expect, it } from 'vitest';
import { ConflictError, ForbiddenError, InvalidTransitionError } from '../errors';
import { money } from '../money';
import { StateMachine } from './machine';
import { bookingMachine, type BookingContext } from './booking';
import { jobMachine, quoteNeedsAdminReview, type JobContext } from './job';

const UPFRONT: BookingContext = { pricingMode: 'UPFRONT' };
const INSPECT: BookingContext = { pricingMode: 'INSPECT_FIRST' };

describe('StateMachine core', () => {
  it('rejects duplicate transition declarations at construction', () => {
    expect(
      () =>
        new StateMachine<'A' | 'B', void>('Thing', [
          { from: 'A', to: 'B' },
          { from: 'A', to: 'B' },
        ]),
    ).toThrow(/Duplicate/);
  });

  it('lists reachable states', () => {
    const m = new StateMachine<'A' | 'B' | 'C', void>('Thing', [
      { from: 'A', to: 'C' },
      { from: 'A', to: 'B' },
    ]);
    expect(m.nextStates('A')).toEqual(['B', 'C']);
    expect(m.nextStates('B')).toEqual([]);
  });

  it('reports terminal states', () => {
    const m = new StateMachine<'A' | 'B', void>('Thing', [{ from: 'A', to: 'B' }], ['B']);
    expect(m.isTerminal('B')).toBe(true);
    expect(m.isTerminal('A')).toBe(false);
  });
});

describe('booking machine — happy path', () => {
  it('walks the full up-front sequence', () => {
    const path = [
      ['DRAFT', 'PENDING_PAYMENT'],
      ['PENDING_PAYMENT', 'CONFIRMED'],
      ['CONFIRMED', 'DISPATCHING'],
      ['DISPATCHING', 'ASSIGNED'],
      ['ASSIGNED', 'EN_ROUTE'],
      ['EN_ROUTE', 'ARRIVED'],
      ['ARRIVED', 'DIAGNOSING'],
      ['DIAGNOSING', 'QUOTE_PENDING'],
      ['QUOTE_PENDING', 'IN_PROGRESS'],
      ['IN_PROGRESS', 'WORK_DONE'],
      ['WORK_DONE', 'PAYMENT_PENDING'],
    ] as const;
    for (const [from, to] of path) {
      expect(() => bookingMachine.assert(from, to, UPFRONT)).not.toThrow();
    }
    expect(() =>
      bookingMachine.assert('PAYMENT_PENDING', 'COMPLETED', {
        ...UPFRONT,
        paymentSettled: true,
      }),
    ).not.toThrow();
  });

  it('rejects skipping straight from DRAFT to COMPLETED', () => {
    expect(() => bookingMachine.assert('DRAFT', 'COMPLETED', UPFRONT)).toThrow(
      InvalidTransitionError,
    );
  });

  it('rejects going backwards', () => {
    expect(() => bookingMachine.assert('COMPLETED', 'DRAFT', UPFRONT)).toThrow(
      InvalidTransitionError,
    );
  });

  it('names the entity and both states in the error', () => {
    try {
      bookingMachine.assert('COMPLETED', 'DRAFT', UPFRONT);
      expect.unreachable();
    } catch (e) {
      const err = e as InvalidTransitionError;
      expect(err.message).toBe('Illegal Booking transition: COMPLETED → DRAFT');
      expect(err.code).toBe('INVALID_TRANSITION');
    }
  });
});

describe('booking machine — inspect-first pricing', () => {
  it('an inspect-first booking is confirmed without pre-payment', () => {
    expect(() => bookingMachine.assert('DRAFT', 'CONFIRMED', INSPECT)).not.toThrow();
  });

  it('an up-front booking may NOT skip payment', () => {
    expect(() => bookingMachine.assert('DRAFT', 'CONFIRMED', UPFRONT)).toThrow(ConflictError);
  });
});

describe('booking machine — failure and side paths', () => {
  it('times out an unpaid booking', () => {
    expect(() => bookingMachine.assert('PENDING_PAYMENT', 'EXPIRED', UPFRONT)).not.toThrow();
  });

  it('fails to assign when rings are exhausted, and can be retried by ops', () => {
    expect(() => bookingMachine.assert('DISPATCHING', 'FAILED_TO_ASSIGN', UPFRONT)).not.toThrow();
    expect(() => bookingMachine.assert('FAILED_TO_ASSIGN', 'DISPATCHING', UPFRONT)).not.toThrow();
  });

  it('routes a declined quote to visit-charge-only', () => {
    expect(() =>
      bookingMachine.assert('QUOTE_PENDING', 'VISIT_CHARGE_ONLY', UPFRONT),
    ).not.toThrow();
    expect(() =>
      bookingMachine.assert('VISIT_CHARGE_ONLY', 'PAYMENT_PENDING', UPFRONT),
    ).not.toThrow();
  });

  it('allows quote revision in both directions', () => {
    expect(() => bookingMachine.assert('QUOTE_PENDING', 'QUOTE_REVISED', UPFRONT)).not.toThrow();
    expect(() => bookingMachine.assert('QUOTE_REVISED', 'QUOTE_PENDING', UPFRONT)).not.toThrow();
  });

  it('permits cancellation from every live state', () => {
    for (const from of ['DRAFT', 'CONFIRMED', 'ASSIGNED', 'EN_ROUTE', 'IN_PROGRESS'] as const) {
      expect(bookingMachine.can(from, 'CANCELLED_BY_USER')).toBe(true);
    }
  });

  it('refuses to cancel an already-terminal booking', () => {
    expect(() => bookingMachine.assert('COMPLETED', 'CANCELLED_BY_USER', UPFRONT)).toThrow(
      InvalidTransitionError,
    );
    expect(() => bookingMachine.assert('EXPIRED', 'CANCELLED_BY_USER', UPFRONT)).toThrow(
      InvalidTransitionError,
    );
  });

  it('cannot complete without settled payment', () => {
    expect(() => bookingMachine.assert('PAYMENT_PENDING', 'COMPLETED', UPFRONT)).toThrow(
      ConflictError,
    );
  });

  it('marks the expected terminal states', () => {
    for (const s of ['COMPLETED', 'EXPIRED', 'DISPUTED', 'NO_SHOW_PARTNER'] as const) {
      expect(bookingMachine.isTerminal(s)).toBe(true);
    }
    expect(bookingMachine.isTerminal('IN_PROGRESS')).toBe(false);
  });
});

// ── job machine ─────────────────────────────────────────────────────────────

const AT_DOOR: JobContext = { distanceToAddressM: 12, startOtpValid: true };

describe('job machine — arrival guards', () => {
  it('accepts arrival at the door with a valid code', () => {
    expect(() => jobMachine.assert('EN_ROUTE', 'ARRIVED', AT_DOOR)).not.toThrow();
  });

  it('rejects arrival from outside the 100 m geofence', () => {
    expect(() =>
      jobMachine.assert('EN_ROUTE', 'ARRIVED', { distanceToAddressM: 450, startOtpValid: true }),
    ).toThrow(ConflictError);
  });

  it('accepts arrival exactly at the geofence boundary', () => {
    expect(() =>
      jobMachine.assert('EN_ROUTE', 'ARRIVED', { distanceToAddressM: 100, startOtpValid: true }),
    ).not.toThrow();
  });

  it('rejects arrival when location is unavailable', () => {
    expect(() => jobMachine.assert('EN_ROUTE', 'ARRIVED', { startOtpValid: true })).toThrow(
      ConflictError,
    );
  });

  it('rejects arrival with a wrong start code even when at the door', () => {
    expect(() =>
      jobMachine.assert('EN_ROUTE', 'ARRIVED', { distanceToAddressM: 5, startOtpValid: false }),
    ).toThrow(ForbiddenError);
  });

  it('tells the partner how far away they are', () => {
    try {
      jobMachine.assert('EN_ROUTE', 'ARRIVED', { distanceToAddressM: 312.7, startOtpValid: true });
      expect.unreachable();
    } catch (e) {
      const err = e as ConflictError;
      expect(err.message).toContain('313 m away');
      expect(err.details['limitM']).toBe(100);
    }
  });
});

describe('job machine — quote approval gate', () => {
  it('starts work when no quote was ever raised', () => {
    expect(() => jobMachine.assert('DIAGNOSING', 'IN_PROGRESS', {})).not.toThrow();
  });

  it('blocks work while a quote is unapproved', () => {
    expect(() =>
      jobMachine.assert('QUOTE_PENDING', 'IN_PROGRESS', {
        quoteExists: true,
        quoteApproved: false,
      }),
    ).toThrow(ConflictError);
  });

  it('allows work once the customer approves', () => {
    expect(() =>
      jobMachine.assert('QUOTE_PENDING', 'IN_PROGRESS', { quoteExists: true, quoteApproved: true }),
    ).not.toThrow();
  });
});

describe('job machine — confined-space PPE hard block', () => {
  it('refuses to start sewer work without PPE photo proof', () => {
    expect(() =>
      jobMachine.assert('DIAGNOSING', 'IN_PROGRESS', { isConfinedSpaceWork: true }),
    ).toThrow(ForbiddenError);
  });

  it('explains that the requirement is legal and unskippable', () => {
    try {
      jobMachine.assert('DIAGNOSING', 'IN_PROGRESS', { isConfinedSpaceWork: true });
      expect.unreachable();
    } catch (e) {
      expect((e as ForbiddenError).message).toContain('legal requirement');
      expect((e as ForbiddenError).details['reason']).toBe('ppe_proof_required');
    }
  });

  it('allows sewer work once PPE proof exists', () => {
    expect(() =>
      jobMachine.assert('DIAGNOSING', 'IN_PROGRESS', {
        isConfinedSpaceWork: true,
        ppePhotoUploaded: true,
      }),
    ).not.toThrow();
  });

  it('applies the block on every route into IN_PROGRESS', () => {
    for (const from of ['DIAGNOSING', 'QUOTE_PENDING', 'QUOTE_REVISED'] as const) {
      expect(() =>
        jobMachine.assert(from, 'IN_PROGRESS', {
          isConfinedSpaceWork: true,
          quoteExists: true,
          quoteApproved: true,
        }),
      ).toThrow(ForbiddenError);
    }
  });
});

describe('job machine — after-photo evidence threshold', () => {
  it('requires an after photo above ₹1,000', () => {
    expect(() =>
      jobMachine.assert('IN_PROGRESS', 'WORK_DONE', {
        finalTotalPaise: money(150_000n),
        afterPhotoCount: 0,
      }),
    ).toThrow(ConflictError);
  });

  it('accepts the job once a photo is attached', () => {
    expect(() =>
      jobMachine.assert('IN_PROGRESS', 'WORK_DONE', {
        finalTotalPaise: money(150_000n),
        afterPhotoCount: 1,
      }),
    ).not.toThrow();
  });

  it('does not require a photo at or below ₹1,000', () => {
    expect(() =>
      jobMachine.assert('IN_PROGRESS', 'WORK_DONE', {
        finalTotalPaise: money(100_000n),
        afterPhotoCount: 0,
      }),
    ).not.toThrow();
  });

  it('does not require a photo when the value is not yet known', () => {
    expect(() => jobMachine.assert('IN_PROGRESS', 'WORK_DONE', {})).not.toThrow();
  });
});

describe('job machine — completion guards', () => {
  const settled = { endOtpValid: true, paymentSettled: true };

  it('completes with a valid end code and settled payment', () => {
    expect(() => jobMachine.assert('WORK_DONE', 'COMPLETED', settled)).not.toThrow();
  });

  it('refuses completion without the end code', () => {
    expect(() =>
      jobMachine.assert('WORK_DONE', 'COMPLETED', { endOtpValid: false, paymentSettled: true }),
    ).toThrow(ForbiddenError);
  });

  it('refuses completion with an unsettled payment', () => {
    expect(() =>
      jobMachine.assert('WORK_DONE', 'COMPLETED', { endOtpValid: true, paymentSettled: false }),
    ).toThrow(ConflictError);
  });

  it('closes a declined-quote job once the visit charge is paid', () => {
    expect(() =>
      jobMachine.assert('VISIT_CHARGE_ONLY', 'COMPLETED', { paymentSettled: true }),
    ).not.toThrow();
  });
});

describe('quoteNeedsAdminReview', () => {
  it('flags a quote more than 30% above the estimate', () => {
    expect(quoteNeedsAdminReview(money(100_000n), money(131_000n))).toBe(true);
  });

  it('does not flag exactly 30% above', () => {
    expect(quoteNeedsAdminReview(money(100_000n), money(130_000n))).toBe(false);
  });

  it('does not flag a quote below the estimate', () => {
    expect(quoteNeedsAdminReview(money(100_000n), money(80_000n))).toBe(false);
  });

  it('cannot apply to an inspect-first booking — the quote is the first price', () => {
    expect(quoteNeedsAdminReview(money(0n), money(500_000n))).toBe(false);
  });
});
