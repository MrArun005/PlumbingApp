/**
 * On-site quotes — how a price comes to exist for an inspect-first booking, and
 * how a revised price gets agreed on an up-front one.
 *
 * The rules that keep this out of dispute territory:
 *  - the customer sees EVERY line, labelled, with the partner's written reason
 *  - material lines above ₹500 need a bill photo
 *  - a quote more than 30% above the booking estimate raises an
 *    ADMIN_REVIEW_FLAG timeline event (BUILD-PROMPT) — it is not blocked, but it
 *    is never invisible
 *  - work cannot start until the customer approves (enforced by jobMachine, not
 *    by this service politely asking)
 *  - on decline, only the visit charge is due
 *
 * All amounts are computed by the pure pricing engine. The partner supplies
 * quantities and unit prices; totals, discounts and GST are never client-side.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import { computePrice, type PriceLineInput } from '@pipefix/pricing';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  format,
  jobMachine,
  money,
  quoteNeedsAdminReview,
  sum,
  type Money,
} from '@pipefix/shared';
import type pino from 'pino';
import { LOGGER, PRISMA } from '../env';
import { DEFAULT_GST_RATE_PCT, PriceRulesService } from '../bookings/price-rules.service';
import {
  bookingStatusForJob,
  assertQuoteWithinSanityLimit,
  materialNeedsBillPhoto,
} from './jobs.service';
import type { CreateQuoteDto } from './jobs.dto';

export interface QuoteView {
  quoteId: string;
  jobId: string;
  status: string;
  reason: string;
  lines: {
    description: string;
    kind: string;
    quantity: number;
    amountPaise: string;
    amountLabel: string;
  }[];
  /** The full engine breakdown, every step labelled for the customer. */
  breakdown: { code: string; label: string; amountPaise: string; amountLabel: string }[];
  totalPaise: string;
  totalLabel: string;
  /** True when this quote is materially above the original estimate. */
  flaggedForReview: boolean;
  /** What the customer pays if they say no. */
  declineChargePaise: string;
  declineChargeLabel: string;
}

@Injectable()
export class QuotesService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
    private readonly priceRules: PriceRulesService,
  ) {}

  /** Partner raises (or revises) a quote after seeing the actual problem. */
  async create(
    partnerId: string,
    jobId: string,
    dto: CreateQuoteDto,
    now: Date,
  ): Promise<QuoteView> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        booking: { include: { address: true, items: { include: { service: true } } } },
        quotes: true,
      },
    });
    if (job === null) throw new NotFoundError('Job', jobId);
    if (job.partnerId !== partnerId) throw new ForbiddenError('This job is not assigned to you.');

    // A quote only makes sense once the partner is on site and has looked.
    if (
      job.status !== 'DIAGNOSING' &&
      job.status !== 'QUOTE_PENDING' &&
      job.status !== 'QUOTE_REVISED'
    ) {
      throw new ConflictError('Diagnose the problem before sending a quote.', {
        status: job.status,
      });
    }

    // Material lines above the threshold must carry a bill photo — this is what
    // makes the 5% weekly ops audit possible.
    for (const line of dto.lines) {
      if (
        line.kind === 'MATERIAL' &&
        materialNeedsBillPhoto(line.unitPricePaise, line.quantity) &&
        line.billPhotoKey === undefined
      ) {
        throw new ConflictError(
          `Attach a photo of the bill for "${line.description}" — material lines over ₹500 need proof.`,
          { description: line.description },
        );
      }
    }

    const resolved = await this.priceRules.resolve(job.booking.address.city, now);

    // Labour and materials go into the engine separately: AMC discounts apply
    // to labour only, and the engine enforces that.
    const labourLines: PriceLineInput[] = dto.lines
      .filter((l) => l.kind === 'LABOUR')
      .map((l) => toPriceLine(l));
    const materialLines: PriceLineInput[] = dto.lines
      .filter((l) => l.kind === 'MATERIAL')
      .map((l) => toPriceLine(l));

    if (labourLines.length === 0) {
      throw new ConflictError('A quote needs at least one labour line.');
    }

    const breakdown = computePrice(
      {
        serviceLines: labourLines,
        materialLines,
        urgencyTier: job.booking.urgencyTier,
        surgeMultiplierX100: job.booking.surgeMultiplierX100,
      },
      resolved.rules,
      now,
    );

    assertQuoteWithinSanityLimit(breakdown.totalPaise);

    const isRevision = job.quotes.length > 0;
    const estimate = money(job.booking.estimateTotalPaise);
    const flagged = quoteNeedsAdminReview(estimate, money(breakdown.totalPaise));

    const visitCharge = sum(job.booking.items.map((i) => money(i.service.visitChargePaise)));

    const quote = await this.prisma.$transaction(async (tx) => {
      // Mark any quote still awaiting a decision as SUPERSEDED. `REVISED` is
      // this schema's word for that — the new quote below becomes the only
      // PENDING (i.e. actionable) one, so the customer cannot accept a stale
      // price after their plumber has sent a corrected figure.
      await tx.quote.updateMany({
        where: { jobId, status: 'PENDING' },
        data: { status: 'REVISED' },
      });

      const created = await tx.quote.create({
        data: {
          jobId,
          status: 'PENDING',
          totalPaise: breakdown.totalPaise,
          lines: {
            create: dto.lines.map((l) => ({
              description: l.description,
              quantity: l.quantity,
              unitPricePaise: l.unitPricePaise,
            })),
          },
        },
      });

      // Material lines are also recorded as MaterialLine rows — that is what
      // the invoice and the ops audit read from.
      for (const line of dto.lines.filter((l) => l.kind === 'MATERIAL')) {
        await tx.materialLine.create({
          data: {
            jobId,
            description: line.description,
            quantity: line.quantity,
            unitPricePaise: line.unitPricePaise,
            ...(line.billPhotoKey === undefined ? {} : { billPhotoKey: line.billPhotoKey }),
          },
        });
      }

      const target = isRevision ? 'QUOTE_REVISED' : 'QUOTE_PENDING';
      jobMachine.assert(job.status, target, {});
      await tx.job.update({ where: { id: jobId }, data: { status: target } });

      const bookingStatus = bookingStatusForJob(target);
      if (bookingStatus !== null) {
        await tx.booking.update({ where: { id: job.bookingId }, data: { status: bookingStatus } });
      }

      await tx.jobTimelineEvent.create({
        data: {
          jobId,
          eventType: isRevision ? 'quote.revised' : 'quote.raised',
          actorType: 'PARTNER',
          actorId: partnerId,
          payload: {
            quoteId: created.id,
            totalPaise: breakdown.totalPaise.toString(),
            reason: dto.reason,
            lineCount: dto.lines.length,
          },
        },
      });

      // The >30% flag is a visible event, not a silent field. Ops queues read it.
      if (flagged) {
        await tx.jobTimelineEvent.create({
          data: {
            jobId,
            eventType: 'ADMIN_REVIEW_FLAG',
            actorType: 'SYSTEM',
            payload: {
              quoteId: created.id,
              reason: 'quote_exceeds_estimate_by_30_percent',
              estimatePaise: estimate.toString(),
              quotePaise: breakdown.totalPaise.toString(),
            },
          },
        });
      }

      return created;
    });

    this.logger.info({
      event: isRevision ? 'quote.revised' : 'quote.raised',
      jobId,
      partnerId,
      quoteId: quote.id,
      totalPaise: breakdown.totalPaise.toString(),
      flaggedForReview: flagged,
    });

    return {
      quoteId: quote.id,
      jobId,
      status: 'PENDING',
      reason: dto.reason,
      lines: dto.lines.map((l) => {
        const amount = (l.unitPricePaise * BigInt(l.quantity)) as Money;
        return {
          description: l.description,
          kind: l.kind,
          quantity: l.quantity,
          amountPaise: amount.toString(),
          amountLabel: format(amount),
        };
      }),
      breakdown: breakdown.lines.map((l) => ({
        code: l.code,
        label: l.label,
        amountPaise: l.amountPaise.toString(),
        amountLabel: format(money(l.amountPaise)),
      })),
      totalPaise: breakdown.totalPaise.toString(),
      totalLabel: format(money(breakdown.totalPaise)),
      flaggedForReview: flagged,
      declineChargePaise: visitCharge.toString(),
      declineChargeLabel: format(visitCharge),
    };
  }

  /**
   * Customer approves. Only now may work begin.
   *
   * Only a PENDING quote is actionable. `REVISED` means SUPERSEDED — a newer
   * quote replaced it — and approving a superseded quote would let a customer
   * (or a stale tab) accept an old, possibly higher price while a live one
   * exists. Re-approving an already-approved quote is a harmless no-op so a
   * double-tap does not error.
   */
  async approve(userId: string, quoteId: string): Promise<{ status: string; totalLabel: string }> {
    const quote = await this.loadCustomerQuote(userId, quoteId);
    if (quote.status === 'APPROVED') {
      return { status: 'APPROVED', totalLabel: format(money(quote.totalPaise)) };
    }
    if (quote.status !== 'PENDING') {
      throw new ConflictError(
        quote.status === 'REVISED'
          ? 'Your plumber sent an updated quote. Please review the latest one.'
          : 'This quote can no longer be approved.',
        { status: quote.status },
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({ where: { id: quoteId }, data: { status: 'APPROVED' } });
      await tx.quoteApproval.create({
        data: { quoteId, method: 'IN_APP', approvedAt: new Date() },
      });
      // The approved quote becomes the booking's real total.
      await tx.booking.update({
        where: { id: quote.job.bookingId },
        data: { finalTotalPaise: quote.totalPaise },
      });
      await tx.jobTimelineEvent.create({
        data: {
          jobId: quote.jobId,
          eventType: 'quote.approved',
          actorType: 'CUSTOMER',
          actorId: userId,
          payload: { quoteId, totalPaise: quote.totalPaise.toString() },
        },
      });
    });

    this.logger.info({
      event: 'quote.approved',
      quoteId,
      jobId: quote.jobId,
      userId,
      totalPaise: quote.totalPaise.toString(),
    });
    return { status: 'APPROVED', totalLabel: format(money(quote.totalPaise)) };
  }

  /** Customer declines. Only the visit charge is due, and the job winds down. */
  async decline(
    userId: string,
    quoteId: string,
    reason: string | undefined,
  ): Promise<{ status: string; visitChargeLabel: string }> {
    const quote = await this.loadCustomerQuote(userId, quoteId);
    // Same rule as approve: only the live (PENDING) quote is actionable.
    if (quote.status !== 'PENDING') {
      throw new ConflictError(
        quote.status === 'REVISED'
          ? 'Your plumber sent an updated quote. Please review the latest one.'
          : 'This quote can no longer be declined.',
        { status: quote.status },
      );
    }

    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: quote.job.bookingId },
      include: { items: { include: { service: true } } },
    });
    const visitCharge = sum(booking.items.map((i) => money(i.service.visitChargePaise)));

    jobMachine.assert(quote.job.status, 'VISIT_CHARGE_ONLY', {});

    await this.prisma.$transaction(async (tx) => {
      await tx.quote.update({ where: { id: quoteId }, data: { status: 'DECLINED' } });
      await tx.job.update({ where: { id: quote.jobId }, data: { status: 'VISIT_CHARGE_ONLY' } });
      await tx.booking.update({
        where: { id: booking.id },
        data: { status: 'VISIT_CHARGE_ONLY', finalTotalPaise: visitCharge },
      });
      await tx.jobTimelineEvent.create({
        data: {
          jobId: quote.jobId,
          eventType: 'quote.declined',
          actorType: 'CUSTOMER',
          actorId: userId,
          payload: { quoteId, visitChargePaise: visitCharge.toString(), reason: reason ?? null },
        },
      });
    });

    this.logger.info({ event: 'quote.declined', quoteId, jobId: quote.jobId, userId });
    return { status: 'DECLINED', visitChargeLabel: format(visitCharge) };
  }

  /** Everything the customer needs to decide, for one job. */
  async listForBooking(userId: string, bookingId: string): Promise<QuoteView[]> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: { include: { service: true } } },
    });
    if (booking === null || booking.userId !== userId)
      throw new NotFoundError('Booking', bookingId);

    const quotes = await this.prisma.quote.findMany({
      where: { job: { bookingId } },
      include: { lines: true },
      orderBy: { createdAt: 'desc' },
    });
    const visitCharge = sum(booking.items.map((i) => money(i.service.visitChargePaise)));

    return quotes.map((q) => ({
      quoteId: q.id,
      jobId: q.jobId,
      status: q.status,
      reason: '', // the written reason lives on the timeline event
      lines: q.lines.map((l) => {
        const amount = (l.unitPricePaise * BigInt(l.quantity)) as Money;
        return {
          description: l.description,
          kind: 'LABOUR',
          quantity: l.quantity,
          amountPaise: amount.toString(),
          amountLabel: format(amount),
        };
      }),
      breakdown: [],
      totalPaise: q.totalPaise.toString(),
      totalLabel: format(money(q.totalPaise)),
      flaggedForReview: quoteNeedsAdminReview(
        money(booking.estimateTotalPaise),
        money(q.totalPaise),
      ),
      declineChargePaise: visitCharge.toString(),
      declineChargeLabel: format(visitCharge),
    }));
  }

  private async loadCustomerQuote(userId: string, quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { job: { include: { booking: { select: { userId: true } } } } },
    });
    if (quote === null) throw new NotFoundError('Quote', quoteId);
    if (quote.job.booking.userId !== userId) throw new NotFoundError('Quote', quoteId);
    return quote;
  }
}

function toPriceLine(line: {
  description: string;
  quantity: number;
  unitPricePaise: bigint;
}): PriceLineInput {
  return {
    label: line.description,
    unitPricePaise: line.unitPricePaise,
    quantity: line.quantity,
    // TODO(ca-review): materials and labour may carry different SAC rates.
    gstRatePct: DEFAULT_GST_RATE_PCT,
  };
}
