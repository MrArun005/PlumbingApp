/**
 * Gateway webhooks. Signature-verified, idempotent and replay-safe: gateways
 * retry aggressively and will happily deliver the same event twice.
 */
import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { UnauthorizedError, parseOrThrow } from '@pipefix/shared';
import { Public } from '../auth/auth.guard';
import { PaymentsService } from './payments.service';

/**
 * Razorpay's envelope, narrowed to what we act on. Unknown event types are
 * acknowledged and ignored — never 500, or the gateway retries forever.
 */
const razorpayEventSchema = z.object({
  event: z.string(),
  payload: z
    .object({
      payment: z
        .object({
          entity: z
            .object({
              id: z.string(),
              order_id: z.string(),
              method: z.string().default('upi'),
            })
            .partial({ method: true }),
        })
        .optional(),
    })
    .default({}),
});

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('razorpay')
  @HttpCode(200)
  async razorpay(
    @Req() req: Request,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Body() body: unknown,
  ): Promise<{ received: true; handled: boolean }> {
    // Verify against the RAW body — a re-serialised object can differ byte-wise
    // and would break a real HMAC.
    const raw = rawBodyOf(req, body);
    if (signature === undefined || !this.payments.verifyWebhookSignature(raw, signature)) {
      throw new UnauthorizedError('Invalid webhook signature.');
    }

    const event = parseOrThrow(razorpayEventSchema, body, 'POST /webhooks/razorpay');
    const entity = event.payload.payment?.entity;

    if (entity === undefined) return { received: true, handled: false };

    switch (event.event) {
      case 'payment.captured':
        await this.payments.markCaptured(entity.order_id, entity.id, entity.method ?? 'upi');
        return { received: true, handled: true };
      case 'payment.failed':
        await this.payments.markFailed(entity.order_id);
        return { received: true, handled: true };
      default:
        // Acknowledge everything else so the gateway stops retrying.
        return { received: true, handled: false };
    }
  }
}

/**
 * Express only retains the raw body when configured to; fall back to a stable
 * re-serialisation so the stub gateway path still works in dev and tests.
 */
function rawBodyOf(req: Request, body: unknown): string {
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  return raw !== undefined ? raw.toString('utf8') : JSON.stringify(body);
}
