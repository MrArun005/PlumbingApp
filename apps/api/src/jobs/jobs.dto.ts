import { z } from 'zod';
import { paiseAmount, trimmedString } from '@pipefix/shared';

/** Partner types the 4-digit code the customer reads aloud. */
export const otpBodySchema = z.object({
  otp: z.string().regex(/^\d{4}$/, 'Expected the 4-digit code from the customer'),
  /** Device location at the moment of check-in, for the arrival geofence. */
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type OtpBodyDto = z.infer<typeof otpBodySchema>;

/**
 * A line on an on-site quote. `kind` separates LABOUR from MATERIAL because AMC
 * discounts apply to labour only, and material lines need bill photos.
 */
export const quoteLineSchema = z.object({
  description: trimmedString.max(160),
  kind: z.enum(['LABOUR', 'MATERIAL']),
  quantity: z.number().int().positive().max(999).default(1),
  unitPricePaise: paiseAmount,
  /** Photo of the parts bill. Required for material lines above ₹500. */
  billPhotoKey: trimmedString.max(256).optional(),
});

export const createQuoteSchema = z.object({
  lines: z.array(quoteLineSchema).min(1, 'A quote needs at least one line').max(30),
  /** Why the work costs what it does — shown verbatim to the customer. */
  reason: trimmedString.max(600),
});
export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;

export const declineQuoteSchema = z.object({
  reason: trimmedString.max(300).optional(),
});
export type DeclineQuoteDto = z.infer<typeof declineQuoteSchema>;

export const photoSchema = z.object({
  phase: z.enum(['BEFORE', 'DURING', 'AFTER', 'MATERIAL_BILL']),
  fileKey: trimmedString.max(256),
  /** Set for the PPE proof photo that unblocks confined-space work. */
  isPpeProof: z.boolean().default(false),
});
export type PhotoDto = z.infer<typeof photoSchema>;
