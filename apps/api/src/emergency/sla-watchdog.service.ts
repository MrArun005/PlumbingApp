/**
 * The money-back guarantee, enforced by the platform rather than by the customer
 * having to complain.
 *
 * Two distinct breaches:
 *  - DISPATCH breach: nobody assigned within 10 minutes on an E0. The emergency
 *    fee is refunded and ₹200 wallet credit is issued automatically.
 *  - ARRIVAL breach: assigned, but did not arrive before slaTargetAt. Same
 *    remedy — the promise was about arrival, not about assignment.
 *
 * Every breach writes an `SLABreachEvent`. PLAN §3.4 calls this the single best
 * supply-planning signal there is, and that is only true if the record is
 * complete — so the remedy and the logging happen in one transaction.
 *
 * Idempotency matters here: this runs on a timer, so it must be safe to run
 * every minute forever. A booking is credited exactly once, guarded by
 * `EmergencyRequest.breached`.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type pino from 'pino';
import { ZERO, format, money, type Money } from '@pipefix/shared';
import { LOGGER, PRISMA } from '../env';

/** No assignment within this window on an E0 triggers the guarantee. */
export const E0_DISPATCH_GUARANTEE_MINUTES = 10;

/** Goodwill credit paid alongside the fee refund (PLAN §3.4). */
export const SLA_BREACH_CREDIT_PAISE = 20_000n; // ₹200

export type BreachType = 'DISPATCH_SLA_BREACH' | 'ARRIVAL_SLA_BREACH';

export interface BreachOutcome {
  bookingId: string;
  emergencyRequestId: string;
  breachType: BreachType;
  refundedPaise: string;
  creditedPaise: string;
  /** True when the on-call dispatcher should be paged. */
  pageOnCall: boolean;
}

@Injectable()
export class SlaWatchdogService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  /**
   * One sweep. Returns every breach it remedied, so the scheduler can log a
   * summary and tests can assert on it.
   */
  async sweep(now: Date): Promise<BreachOutcome[]> {
    const outcomes: BreachOutcome[] = [];

    const dispatchCutoff = new Date(now.getTime() - E0_DISPATCH_GUARANTEE_MINUTES * 60 * 1000);

    const candidates = await this.prisma.emergencyRequest.findMany({
      where: {
        breached: false,
        arrivedAt: null,
        OR: [
          // Never assigned, and the dispatch guarantee window has passed.
          { assignedAt: null, createdAt: { lte: dispatchCutoff } },
          // Assigned but did not arrive before the promised time.
          { assignedAt: { not: null }, slaTargetAt: { lte: now } },
        ],
      },
      include: { booking: { include: { payments: true } } },
    });

    for (const request of candidates) {
      const breachType: BreachType =
        request.assignedAt === null ? 'DISPATCH_SLA_BREACH' : 'ARRIVAL_SLA_BREACH';
      outcomes.push(await this.remedy(request, breachType, now));
    }

    if (outcomes.length > 0) {
      this.logger.warn({
        event: 'sla.sweep_found_breaches',
        count: outcomes.length,
        dispatchBreaches: outcomes.filter((o) => o.breachType === 'DISPATCH_SLA_BREACH').length,
      });
    }
    return outcomes;
  }

  /**
   * Refund the emergency fee, credit the goodwill amount, mark the request
   * breached, and record the event — all in one transaction so a partial remedy
   * is impossible.
   */
  private async remedy(
    request: {
      id: string;
      bookingId: string;
      issueType: string;
      assignedAt: Date | null;
      slaTargetAt: Date;
      booking: {
        id: string;
        userId: string;
        urgencyTier: string;
        emergencyFeePaise: bigint;
        status: string;
        payments: { id: string; status: string; amountPaise: bigint }[];
      };
    },
    breachType: BreachType,
    now: Date,
  ): Promise<BreachOutcome> {
    const feePaise = money(request.booking.emergencyFeePaise);
    const captured = request.booking.payments.find((p) => p.status === 'CAPTURED');

    // Only refund money we actually took. An uncaptured pre-auth simply lapses.
    const refundPaise: Money = captured === undefined ? ZERO : feePaise;

    await this.prisma.$transaction(async (tx) => {
      await tx.emergencyRequest.update({ where: { id: request.id }, data: { breached: true } });

      if (refundPaise > 0n && captured !== undefined) {
        await tx.refund.create({
          data: {
            paymentId: captured.id,
            amountPaise: refundPaise,
            reasonCode: breachType,
            status: 'PENDING', // the gateway call is made by the payout worker
          },
        });
      }

      // Wallet credit. balanceAfterPaise keeps the ledger auditable without a
      // separate balance query later.
      const lastEntry = await tx.walletLedger.findFirst({
        where: { userId: request.booking.userId },
        orderBy: { createdAt: 'desc' },
      });
      const balanceAfter = (lastEntry?.balanceAfterPaise ?? 0n) + SLA_BREACH_CREDIT_PAISE;
      await tx.walletLedger.create({
        data: {
          ownerType: 'USER',
          userId: request.booking.userId,
          direction: 'CREDIT',
          reasonCode: 'SLA_BREACH_CREDIT',
          amountPaise: SLA_BREACH_CREDIT_PAISE,
          balanceAfterPaise: balanceAfter,
          refType: 'Booking',
          refId: request.bookingId,
        },
      });

      await tx.sLABreachEvent.create({
        data: {
          breachType,
          bookingId: request.bookingId,
          details: {
            issueType: request.issueType,
            urgencyTier: request.booking.urgencyTier,
            slaTargetAt: request.slaTargetAt.toISOString(),
            assignedAt: request.assignedAt?.toISOString() ?? null,
            refundedPaise: refundPaise.toString(),
            creditedPaise: SLA_BREACH_CREDIT_PAISE.toString(),
          },
          occurredAt: now,
        },
      });
    });

    // A dispatch breach means we had no supply at all — that needs a human now,
    // not in the morning.
    const pageOnCall = breachType === 'DISPATCH_SLA_BREACH';

    this.logger.error({
      event: 'sla.breach_remedied',
      breachType,
      bookingId: request.bookingId,
      emergencyRequestId: request.id,
      refundedPaise: refundPaise.toString(),
      creditedPaise: SLA_BREACH_CREDIT_PAISE.toString(),
      refundLabel: format(refundPaise),
      pageOnCall,
    });

    return {
      bookingId: request.bookingId,
      emergencyRequestId: request.id,
      breachType,
      refundedPaise: refundPaise.toString(),
      creditedPaise: SLA_BREACH_CREDIT_PAISE.toString(),
      pageOnCall,
    };
  }
}
