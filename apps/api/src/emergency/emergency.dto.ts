import { z } from 'zod';
import { trimmedString } from '@pipefix/shared';

export const emergencyIssueTypes = [
  'BURST_PIPE',
  'FLOODING',
  'SEWAGE_BACKFLOW',
  'NO_WATER',
  'GEYSER_LEAK',
  'TANK_OVERFLOW',
  'GAS_SMELL',
  'OTHER',
] as const;

/**
 * SOS intake. Deliberately tiny — the target is ≤20 seconds from tapping the
 * button to dispatch, so the only required fields are what the issue is and
 * where. Everything else (media, extra detail) is optional and can arrive after
 * dispatch has already started.
 */
export const createEmergencySchema = z.object({
  issueType: z.enum(emergencyIssueTypes),
  addressId: trimmedString,
  /** Optional 10-second video / photos uploaded from the intake screen. */
  mediaKeys: z.array(trimmedString.max(256)).max(5).default([]),
  /** Free-text detail, only used when issueType is OTHER. */
  note: trimmedString.max(300).optional(),
});
export type CreateEmergencyDto = z.infer<typeof createEmergencySchema>;

export const acknowledgeSafetySchema = z.object({
  /** Version of the card that was actually displayed — recorded for audit. */
  safetyScriptVersion: z.number().int().min(0),
  /** True when the customer could not perform the steps (e.g. cannot reach the valve). */
  couldNotComply: z.boolean().default(false),
});
export type AcknowledgeSafetyDto = z.infer<typeof acknowledgeSafetySchema>;
