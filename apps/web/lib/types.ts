/**
 * Wire types, mirrored by hand from the API.
 *
 * These are copies of the contracts in `apps/api/src/catalog/catalog.service.ts`
 * and `apps/api/src/bookings/bookings.service.ts`. They are duplicated rather
 * than imported because the web app must not depend on the Nest app's build
 * output. If you change a contract there, change it here in the same commit.
 *
 * Money never arrives as a number. Every amount is either a decimal string of
 * paise (`*Paise`) or a pre-formatted label (`*Label`) that the API produced.
 * The client renders labels and does no arithmetic — see PriceBlock.
 */

export type PriceDisplayKind = 'EXACT' | 'FROM' | 'PER_UNIT' | 'INSPECTION_FIRST' | 'QUOTE_ONLY';

export interface PriceDisplay {
  kind: PriceDisplayKind;
  /** Absent for INSPECTION_FIRST / QUOTE_ONLY — there is no job price yet. */
  amountPaise?: string;
  amountLabel?: string;
  visitChargePaise: string;
  visitChargeLabel: string;
  headline: string;
  note: string;
}

/** One pre-visit diagnostic question, as seeded in `packages/db/prisma/seed.ts`. */
export interface PreVisitQuestion {
  q: string;
  options?: string[];
  /** 'media' means "upload a photo" — not supported on the web yet. */
  type?: string;
  optional?: boolean;
}

export interface ServiceView {
  sku: string;
  name: string;
  shortDesc: string;
  longDesc: string | null;
  categoryCode: string;
  estDurationMin: number;
  skillTier: string;
  materialsPolicy: string;
  warrantyDays: number;
  urgencyEligible: string[];
  requiredTools: string[];
  preVisitQuestions: unknown;
  /** True when the plumber must inspect before any price exists. */
  inspectFirst: boolean;
  price: PriceDisplay;
}

export interface CategoryView {
  code: string;
  name: string;
  iconKey: string | null;
  serviceCount: number;
}

export type BookingStatus =
  | 'DRAFT'
  | 'PENDING_PAYMENT'
  | 'EXPIRED'
  | 'CONFIRMED'
  | 'DISPATCHING'
  | 'FAILED_TO_ASSIGN'
  | 'ASSIGNED'
  | 'EN_ROUTE'
  | 'ARRIVED'
  | 'DIAGNOSING'
  | 'QUOTE_PENDING'
  | 'QUOTE_REVISED'
  | 'VISIT_CHARGE_ONLY'
  | 'IN_PROGRESS'
  | 'WORK_DONE'
  | 'PAYMENT_PENDING'
  | 'COMPLETED'
  | 'CANCELLED_BY_USER'
  | 'CANCELLED_BY_PARTNER'
  | 'NO_SHOW_CUSTOMER'
  | 'NO_SHOW_PARTNER'
  | 'DISPUTED';

export interface BookingView {
  id: string;
  status: BookingStatus;
  urgencyTier: string;
  pricingMode: 'UPFRONT' | 'INSPECT_FIRST';
  scheduledSlotStart: string | null;
  scheduledSlotEnd: string | null;
  items: { sku: string; name: string; quantity: number; unitPriceLabel: string | null }[];
  /** Null means "no price exists yet, by design" — never render a 0 for this. */
  estimate: {
    totalPaise: string;
    totalLabel: string;
    lines: { code: string; label: string; amountPaise: string; amountLabel: string }[];
  } | null;
  visitChargePaise: string;
  visitChargeLabel: string;
  whatHappensNext: string;
  createdAt: string;
}

/** POST /auth/otp/request */
export interface OtpRequestResult {
  expiresInSec: number;
  /** Present only outside production, so local dev can log in without SMS. */
  devCode?: string;
}

/** POST /auth/otp/verify */
export interface CustomerSession {
  accessToken: string;
  refreshToken: string;
  expiresInSec?: number;
  user: { id: string; phone: string; name: string };
}

/** The API's error envelope (see apps/api/src/common/app-error.filter.ts). */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export interface CreateBookingItem {
  sku: string;
  quantity: number;
  preVisitAnswers: unknown[];
}

export interface CreateBookingRequest {
  addressId: string;
  items: CreateBookingItem[];
  urgencyTier: 'E2' | 'E3';
  inspectFirst: boolean;
  scheduledSlotStart?: string;
  scheduledSlotEnd?: string;
  couponCode?: string;
}
