/**
 * Boundary schemas for the pricing engine (BUILD-PROMPT rule 7: zod at every
 * boundary; types derive from schemas — never hand-written twice).
 *
 * Multipliers are integers scaled ×100 (150 = 1.50×). Money is bigint paise.
 */
import { z } from 'zod';

const paise = z.bigint();
const paiseNonNegative = paise.nonnegative();

export const priceLineInputSchema = z.object({
  label: z.string().min(1),
  unitPricePaise: paiseNonNegative,
  quantity: z.number().int().positive(),
  /** Per-line GST rate from the SKU's SAC code. TODO(ca-review): real rates. */
  gstRatePct: z.number().int().min(0).max(28),
});
export type PriceLineInput = z.infer<typeof priceLineInputSchema>;

export const couponInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('FLAT'), flatPaise: paise.positive() }),
  z.object({
    kind: z.literal('PERCENT'),
    percent: z.number().int().min(1).max(100),
    maxDiscountPaise: paise.positive().optional(),
  }),
]);
export type CouponInput = z.infer<typeof couponInputSchema>;

export const amcInputSchema = z.object({
  /** Discount applies to LABOUR only (services + add-ons), never materials. */
  repairDiscountPct: z.number().int().min(0).max(100),
  zeroEmergencyFee: z.boolean(),
  /** AMC Plus: surge experienced by the member is capped (e.g. 125 = 1.25×). */
  surgeCapX100: z.number().int().min(100).optional(),
});
export type AmcInput = z.infer<typeof amcInputSchema>;

export const priceInputSchema = z.object({
  serviceLines: z.array(priceLineInputSchema).min(1),
  addOnLines: z.array(priceLineInputSchema).default([]),
  /** On-site quote only — empty at booking time. */
  materialLines: z.array(priceLineInputSchema).default([]),
  urgencyTier: z.enum(['E0', 'E1', 'E2', 'E3']),
  /** Frozen at booking time from the surge window (100 = no surge). */
  surgeMultiplierX100: z.number().int().min(100),
  amc: amcInputSchema.optional(),
  coupon: couponInputSchema.optional(),
});
export type PriceInput = z.input<typeof priceInputSchema>;

export const priceRuleSetSchema = z.object({
  night: z.object({
    multiplierX100: z.number().int().min(100),
    startHourIst: z.number().int().min(0).max(23),
    endHourIst: z.number().int().min(0).max(23),
  }),
  holiday: z.object({
    multiplierX100: z.number().int().min(100),
    sundays: z.boolean(),
    holidayDatesIst: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  }),
  emergencyFee: z.object({
    e0Paise: paiseNonNegative,
    e1Paise: paiseNonNegative,
    /** E1 fee waived when the pre-multiplier subtotal EXCEEDS this. */
    e1WaiverSubtotalOverPaise: paiseNonNegative,
    /** TODO(ca-review): GST treatment of convenience fees. */
    gstRatePct: z.number().int().min(0).max(28),
  }),
  surge: z.object({ capX100: z.number().int().min(100) }),
});
export type PriceRuleSet = z.input<typeof priceRuleSetSchema>;

/** One row the customer app renders verbatim. Negative = discount. */
export interface BreakdownLine {
  code:
    | 'ITEM'
    | 'ADD_ON'
    | 'MATERIAL'
    | 'SURGE'
    | 'TIME'
    | 'EMERGENCY_FEE'
    | 'AMC_DISCOUNT'
    | 'COUPON'
    | 'GST';
  label: string;
  amountPaise: bigint;
}

export interface PriceBreakdown {
  lines: BreakdownLine[];
  /** Σ taxable + Σ GST. The ONLY number a client may charge. */
  totalPaise: bigint;
  /** Pre-GST taxable total (after all multipliers and discounts). */
  taxableTotalPaise: bigint;
  gstTotalPaise: bigint;
  meta: {
    surgeAppliedX100: number;
    timeAppliedX100: number;
    timeReason: 'NONE' | 'NIGHT' | 'SUNDAY' | 'HOLIDAY';
    emergencyFeePaise: bigint;
    emergencyFeeWaived: boolean;
  };
}
