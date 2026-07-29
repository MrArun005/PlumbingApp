/**
 * Zod helpers used at every boundary (rule 7): request DTOs, webhook
 * payloads, queue job payloads. Types derive from schemas via `z.infer` —
 * never hand-written twice.
 */
import { z } from 'zod';
import { ValidationError } from './errors';
import { money, type Money } from './money';

/** Parse or throw our typed ValidationError (never a raw ZodError upstream). */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  data: unknown,
  boundary: string,
): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(`Invalid payload at ${boundary}`, {
      boundary,
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data as z.infer<S>;
}

/** Indian mobile in E.164: +91 followed by a 10-digit number starting 6-9. */
export const phoneE164In = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Expected an Indian mobile in E.164 format, e.g. +919876543210');

/** Indian PIN code: 6 digits, cannot start with 0. */
export const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Expected a 6-digit Indian PIN code');

/**
 * Money at a JSON boundary: accepts an integer-string ("19900") or a safe
 * integer, produces branded Money. bigint itself is not JSON-representable,
 * so wire formats always carry paise as strings.
 */
export const paiseAmount: z.ZodType<Money, z.ZodTypeDef, unknown> = z
  .union([z.string().regex(/^-?\d+$/), z.number().int()])
  .transform((v) => money(v));

/** Non-empty trimmed string — the default for any human-entered text field. */
export const trimmedString = z.string().trim().min(1);
