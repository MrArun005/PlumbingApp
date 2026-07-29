/**
 * Payments. The gateway itself is behind `PaymentGateway` so the real Razorpay
 * client can drop in without touching this service or its tests.
 *
 * STUBBED TODAY: `StubGateway` creates plausible order ids and captures
 * immediately. Real Razorpay needs live keys + business KYC (see
 * docs/DEPLOY.md pre-launch checklist), so it is not wired yet — but every
 * call site, state transition and webhook shape here is the real one.
 */
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type pino from 'pino';
import { ConflictError, NotFoundError, bookingMachine, format, money } from '@pipefix/shared';
import { LOGGER, PRISMA } from '../env';

export interface GatewayOrder {
  gatewayOrderId: string;
  amountPaise: bigint;
  currency: 'INR';
}

/** The seam a real Razorpay client implements. */
export interface PaymentGateway {
  readonly name: string;
  createOrder(input: { amountPaise: bigint; receipt: string }): Promise<GatewayOrder>;
  /** Verify a webhook signature. Real impl: HMAC-SHA256 over the raw body. */
  verifyWebhookSignature(rawBody: string, signature: string): boolean;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/**
 * Chooses the gateway for an environment. Extracted from the Nest module so it
 * can be tested directly — NestJS calls `process.exit` when a provider factory
 * throws during bootstrap, which takes the test runner down with it.
 *
 * In production this THROWS unless a real gateway is wired. A stub silently
 * accepting production payments would be far worse than a refused boot.
 */
export function createPaymentGateway(env: { NODE_ENV: string }): PaymentGateway {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production payment gateway is configured. Wire Razorpay (live keys + completed KYC) before deploying to production.',
    );
  }
  return new StubGateway();
}

/** Local/dev gateway. Never selected when NODE_ENV=production. */
export class StubGateway implements PaymentGateway {
  readonly name = 'stub';

  async createOrder(input: { amountPaise: bigint; receipt: string }): Promise<GatewayOrder> {
    return {
      gatewayOrderId: `order_stub_${randomBytes(8).toString('hex')}`,
      amountPaise: input.amountPaise,
      currency: 'INR',
    };
  }

  /** Dev-only: accept the fixed test signature so webhook tests are honest. */
  verifyWebhookSignature(_rawBody: string, signature: string): boolean {
    return signature === 'stub-signature';
  }
}

export interface PaymentIntentView {
  paymentId: string;
  gateway: string;
  gatewayOrderId: string;
  amountPaise: string;
  amountLabel: string;
  /** What the client should do next — e.g. open the UPI intent. */
  action: 'OPEN_GATEWAY_CHECKOUT' | 'NOTHING_TO_PAY';
}

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Start payment for a booking. Idempotent at the booking level: an existing
   * unpaid intent is returned rather than creating a second order.
   */
  async createIntent(userId: string, bookingId: string): Promise<PaymentIntentView> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (booking === null || booking.userId !== userId)
      throw new NotFoundError('Booking', bookingId);

    if (booking.pricingMode === 'INSPECT_FIRST') {
      throw new ConflictError(
        'There is nothing to pay yet — you will approve a quote after the inspection.',
        { pricingMode: booking.pricingMode },
      );
    }
    if (booking.status !== 'PENDING_PAYMENT') {
      throw new ConflictError('This booking is not awaiting payment.', { status: booking.status });
    }

    const existing = await this.prisma.payment.findFirst({
      where: { bookingId, status: { in: ['CREATED', 'AUTHORIZED'] } },
    });
    if (existing !== null && existing.gatewayOrderId !== null) {
      return {
        paymentId: existing.id,
        gateway: existing.gateway,
        gatewayOrderId: existing.gatewayOrderId,
        amountPaise: existing.amountPaise.toString(),
        amountLabel: format(money(existing.amountPaise)),
        action: 'OPEN_GATEWAY_CHECKOUT',
      };
    }

    const order = await this.gateway.createOrder({
      amountPaise: booking.estimateTotalPaise,
      receipt: `bkg_${booking.id}`,
    });

    const payment = await this.prisma.payment.create({
      data: {
        bookingId,
        gateway: this.gateway.name,
        gatewayOrderId: order.gatewayOrderId,
        amountPaise: order.amountPaise,
        status: 'CREATED',
      },
    });

    this.logger.info({
      event: 'payment.intent_created',
      bookingId,
      paymentId: payment.id,
      gateway: this.gateway.name,
      amountPaise: order.amountPaise.toString(),
    });

    return {
      paymentId: payment.id,
      gateway: payment.gateway,
      gatewayOrderId: order.gatewayOrderId,
      amountPaise: order.amountPaise.toString(),
      amountLabel: format(money(order.amountPaise)),
      action: 'OPEN_GATEWAY_CHECKOUT',
    };
  }

  /**
   * Handle a captured payment. Replay-safe: capturing an already-captured
   * payment is a no-op, because gateways retry webhooks and we must not
   * double-confirm a booking.
   */
  async markCaptured(
    gatewayOrderId: string,
    gatewayPaymentId: string,
    method: string,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId } });
    if (payment === null) throw new NotFoundError('Payment', gatewayOrderId);

    if (payment.status === 'CAPTURED') {
      this.logger.info({ event: 'payment.capture_replayed', paymentId: payment.id });
      return;
    }

    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: payment.bookingId },
    });

    // Only advance the booking if it is still waiting. A late webhook on an
    // expired or cancelled booking must not resurrect it — that becomes a
    // refund, handled by WO-11.
    const shouldConfirm = booking.status === 'PENDING_PAYMENT';
    if (shouldConfirm) {
      bookingMachine.assert('PENDING_PAYMENT', 'CONFIRMED', {
        pricingMode: booking.pricingMode,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'CAPTURED',
          gatewayPaymentId,
          capturedAt: new Date(),
          method: normaliseMethod(method),
        },
      });
      if (shouldConfirm) {
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED' } });
      }
    });

    this.logger.info({
      event: 'payment.captured',
      paymentId: payment.id,
      bookingId: booking.id,
      bookingConfirmed: shouldConfirm,
      lateWebhookOnStatus: shouldConfirm ? undefined : booking.status,
    });
  }

  async markFailed(gatewayOrderId: string): Promise<void> {
    const payment = await this.prisma.payment.findUnique({ where: { gatewayOrderId } });
    if (payment === null) throw new NotFoundError('Payment', gatewayOrderId);
    if (payment.status === 'CAPTURED') {
      // A failure after a successful capture is nonsense; keep the capture.
      this.logger.warn({ event: 'payment.failure_after_capture_ignored', paymentId: payment.id });
      return;
    }
    await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } });
    this.logger.info({ event: 'payment.failed', paymentId: payment.id });
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return this.gateway.verifyWebhookSignature(rawBody, signature);
  }
}

function normaliseMethod(method: string): 'UPI' | 'CARD' | 'NETBANKING' | 'WALLET' | 'CASH' {
  const upper = method.toUpperCase();
  switch (upper) {
    case 'UPI':
    case 'CARD':
    case 'NETBANKING':
    case 'WALLET':
    case 'CASH':
      return upper;
    default:
      return 'UPI'; // UPI is the dominant Indian rail; safest default label
  }
}
