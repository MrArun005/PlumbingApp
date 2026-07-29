import { z } from 'zod';
import { trimmedString } from '@pipefix/shared';

const skuSchema = z.string().regex(/^PLB-[A-Z]{3,4}-\d{3}$/, 'Expected a SKU like PLB-DRN-004');

export const createBookingSchema = z
  .object({
    addressId: trimmedString,
    items: z
      .array(
        z.object({
          sku: skuSchema,
          quantity: z.number().int().positive().max(50).default(1),
          /** Answers to the SKU's pre-visit diagnostic questions. */
          preVisitAnswers: z.array(z.unknown()).default([]),
        }),
      )
      .min(1, 'Add at least one service to the booking')
      .max(10),
    /** E2 = same-day, E3 = scheduled. E0/E1 use the dedicated emergency path. */
    urgencyTier: z.enum(['E2', 'E3']),
    /**
     * Ask the plumber to inspect and quote on site instead of paying a
     * catalogue price up front. Forced ON for services that have no up-front
     * price at all (INSPECTION_FIRST / QUOTE_ONLY).
     */
    inspectFirst: z.boolean().default(false),
    /** Required for E3; ignored for E2 (which is "today"). */
    scheduledSlotStart: z.coerce.date().optional(),
    scheduledSlotEnd: z.coerce.date().optional(),
    couponCode: trimmedString.max(32).optional(),
  })
  .refine(
    (v) =>
      v.urgencyTier !== 'E3' ||
      (v.scheduledSlotStart !== undefined && v.scheduledSlotEnd !== undefined),
    { message: 'Scheduled bookings need a time slot', path: ['scheduledSlotStart'] },
  )
  .refine(
    (v) =>
      v.scheduledSlotStart === undefined ||
      v.scheduledSlotEnd === undefined ||
      v.scheduledSlotEnd > v.scheduledSlotStart,
    { message: 'The slot must end after it starts', path: ['scheduledSlotEnd'] },
  );

export type CreateBookingDto = z.infer<typeof createBookingSchema>;

export const cancelBookingSchema = z.object({
  reason: trimmedString.max(200).optional(),
});
export type CancelBookingDto = z.infer<typeof cancelBookingSchema>;
