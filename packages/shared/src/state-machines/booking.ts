/**
 * Booking lifecycle — implements the diagram in BUILD-PROMPT "STATE MACHINE"
 * literally.
 *
 *   DRAFT → PENDING_PAYMENT → CONFIRMED → DISPATCHING → ASSIGNED → EN_ROUTE
 *         → ARRIVED → DIAGNOSING → [QUOTE_PENDING ⇄ QUOTE_REVISED]
 *         → IN_PROGRESS → WORK_DONE → PAYMENT_PENDING → COMPLETED
 *
 * Plus: 15-minute payment timeout → EXPIRED; rings exhausted →
 * FAILED_TO_ASSIGN; quote declined → VISIT_CHARGE_ONLY → COMPLETED; and the
 * cancellation/no-show/dispute side-states reachable from any live state.
 *
 * One addition to the spec (docs/DECISIONS.md D-009): DRAFT → CONFIRMED is
 * legal when the booking is INSPECT_FIRST, because there is genuinely nothing
 * to charge up front — the price does not exist until the plumber has looked.
 */
import { ConflictError } from '../errors';
import { StateMachine, type Transition } from './machine';

export const BOOKING_STATES = [
  'DRAFT',
  'PENDING_PAYMENT',
  'EXPIRED',
  'CONFIRMED',
  'DISPATCHING',
  'FAILED_TO_ASSIGN',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_PENDING',
  'QUOTE_REVISED',
  'VISIT_CHARGE_ONLY',
  'IN_PROGRESS',
  'WORK_DONE',
  'PAYMENT_PENDING',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_PARTNER',
  'NO_SHOW_CUSTOMER',
  'NO_SHOW_PARTNER',
  'DISPUTED',
] as const;

export type BookingState = (typeof BOOKING_STATES)[number];

/** Everything a booking guard may consider. Assembled by the caller. */
export interface BookingContext {
  /** INSPECT_FIRST bookings show no price up front and skip pre-payment. */
  pricingMode: 'UPFRONT' | 'INSPECT_FIRST';
  /** A payment row exists in CAPTURED (or cash-marked) state. */
  paymentSettled?: boolean;
}

const TERMINAL: BookingState[] = [
  'EXPIRED',
  'COMPLETED',
  'CANCELLED_BY_USER',
  'CANCELLED_BY_PARTNER',
  'NO_SHOW_CUSTOMER',
  'NO_SHOW_PARTNER',
  'DISPUTED',
];

/** States where the job is live and a cancellation/no-show can still happen. */
const LIVE_STATES: BookingState[] = [
  'DRAFT',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'DISPATCHING',
  'ASSIGNED',
  'EN_ROUTE',
  'ARRIVED',
  'DIAGNOSING',
  'QUOTE_PENDING',
  'QUOTE_REVISED',
  'IN_PROGRESS',
  'WORK_DONE',
  'PAYMENT_PENDING',
];

const requiresInspectFirst: (ctx: BookingContext) => void = (ctx) => {
  if (ctx.pricingMode !== 'INSPECT_FIRST') {
    throw new ConflictError(
      'This booking has an up-front price, so it must be paid before it is confirmed.',
      { pricingMode: ctx.pricingMode },
    );
  }
};

const requiresSettledPayment: (ctx: BookingContext) => void = (ctx) => {
  if (ctx.paymentSettled !== true) {
    throw new ConflictError('This booking cannot be completed until payment is settled.');
  }
};

const happyPath: Transition<BookingState, BookingContext>[] = [
  { from: 'DRAFT', to: 'PENDING_PAYMENT' },
  // Nothing to charge yet on an inspect-first booking.
  { from: 'DRAFT', to: 'CONFIRMED', guards: [requiresInspectFirst] },
  { from: 'PENDING_PAYMENT', to: 'CONFIRMED' },
  { from: 'PENDING_PAYMENT', to: 'EXPIRED' }, // 15-minute timeout
  { from: 'CONFIRMED', to: 'DISPATCHING' },
  { from: 'DISPATCHING', to: 'ASSIGNED' },
  { from: 'DISPATCHING', to: 'FAILED_TO_ASSIGN' }, // all rings exhausted
  // Ops may re-run dispatch after a failure (manual assign path).
  { from: 'FAILED_TO_ASSIGN', to: 'DISPATCHING' },
  { from: 'ASSIGNED', to: 'EN_ROUTE' },
  { from: 'EN_ROUTE', to: 'ARRIVED' },
  { from: 'ARRIVED', to: 'DIAGNOSING' },
  { from: 'DIAGNOSING', to: 'QUOTE_PENDING' },
  // No quote needed — fixed-price work can start straight after diagnosis.
  { from: 'DIAGNOSING', to: 'IN_PROGRESS' },
  { from: 'QUOTE_PENDING', to: 'QUOTE_REVISED' },
  { from: 'QUOTE_REVISED', to: 'QUOTE_PENDING' },
  { from: 'QUOTE_PENDING', to: 'IN_PROGRESS' }, // approved
  { from: 'QUOTE_REVISED', to: 'IN_PROGRESS' },
  { from: 'QUOTE_PENDING', to: 'VISIT_CHARGE_ONLY' }, // declined
  { from: 'QUOTE_REVISED', to: 'VISIT_CHARGE_ONLY' },
  { from: 'VISIT_CHARGE_ONLY', to: 'PAYMENT_PENDING' },
  { from: 'IN_PROGRESS', to: 'WORK_DONE' },
  { from: 'WORK_DONE', to: 'PAYMENT_PENDING' },
  { from: 'PAYMENT_PENDING', to: 'COMPLETED', guards: [requiresSettledPayment] },
];

/** Cancellations, no-shows and disputes are reachable from any live state. */
const sideStates: Transition<BookingState, BookingContext>[] = LIVE_STATES.flatMap((from) =>
  (
    [
      'CANCELLED_BY_USER',
      'CANCELLED_BY_PARTNER',
      'NO_SHOW_CUSTOMER',
      'NO_SHOW_PARTNER',
      'DISPUTED',
    ] as const
  ).map((to) => ({ from, to })),
);

export const bookingMachine = new StateMachine<BookingState, BookingContext>(
  'Booking',
  [...happyPath, ...sideStates],
  TERMINAL,
);
