/** Request/response schemas for the auth boundary. Types derive from these. */
import { z } from 'zod';
import { phoneE164In, trimmedString } from '@pipefix/shared';

export const otpRequestSchema = z.object({ phone: phoneE164In });
export type OtpRequestDto = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  phone: phoneE164In,
  code: z.string().regex(/^\d{6}$/, 'Expected the 6-digit code we sent you'),
  /** New customers are created on first verified login. */
  name: trimmedString.max(80).optional(),
});
export type OtpVerifyDto = z.infer<typeof otpVerifySchema>;

export const partnerOtpVerifySchema = otpVerifySchema.extend({
  /** Partner sessions are bound to one device (anti account-sharing). */
  deviceId: trimmedString.max(128),
});
export type PartnerOtpVerifyDto = z.infer<typeof partnerOtpVerifySchema>;

export const refreshSchema = z.object({ refreshToken: trimmedString });
export type RefreshDto = z.infer<typeof refreshSchema>;
