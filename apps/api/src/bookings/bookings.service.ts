/**
 * Booking creation and lifecycle for the scheduled tiers (E2/E3).
 *
 * The two pricing paths, which are the crux of this module:
 *
 *  UPFRONT        — every line has a catalogue price. We compute the full
 *                   breakdown now, freeze the surge multiplier and the price
 *                   rule versions, and the customer pays before we dispatch.
 *
 *  INSPECT_FIRST  — NO amount is quoted or charged. estimateTotalPaise is 0,
 *                   the booking is confirmed immediately (nothing to pay), and
 *                   the price is established on site via an itemised quote the
 *                   customer must approve. Chosen either by the customer or
 *                   forced by the SKU (INSPECTION_FIRST / QUOTE_ONLY services
 *                   have no up-front price to show).
 *
 * Every status change goes through `bookingMachine` — there is no bare
 * `status:` write in this file that skips it.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { Booking, BookingStatus, PrismaClient, Service } from '@pipefix/db';
import { computePrice, type PriceBreakdown, type PriceLineInput } from '@pipefix/pricing';
import {
  ConflictError,
  NotFoundError,
  ZERO,
  bookingMachine,
  format,
  money,
  sum,
  type BookingState,
  type Money,
} from '@pipefix/shared';
import type pino from 'pino';
import { ENV, LOGGER, PRISMA, type ApiEnv } from '../env';
import { DEFAULT_GST_RATE_PCT, PriceRulesService } from './price-rules.service';
import type { CreateBookingDto } from './bookings.dto';

/** Wire shape — bigints are strings, and amounts are absent when unknown. */
export interface BookingView {
  id: string;
  status: BookingStatus;
  urgencyTier: string;
  pricingMode: 'UPFRONT' | 'INSPECT_FIRST';
  scheduledSlotStart: string | null;
  scheduledSlotEnd: string | null;
  items: { sku: string; name: string; quantity: number; unitPriceLabel: string | null }[];
  /** Populated for UPFRONT only. Null means "no price exists yet, by design". */
  estimate: {
    totalPaise: string;
    totalLabel: string;
    lines: { code: string; label: string; amountPaise: string; amountLabel: string }[];
  } | null;
  /** What the customer owes if they decline the on-site quote. */
  visitChargePaise: string;
  visitChargeLabel: string;
  /** Plain-language explanation of what happens next. */
  whatHappensNext: string;
  createdAt: string;
}

@Injectable()
export class BookingsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
    @Inject(ENV) private readonly env: ApiEnv,
    private readonly priceRules: PriceRulesService,
  ) {}

  async create(userId: string, dto: CreateBookingDto, now: Date): Promise<BookingView> {
    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (address === null || address.userId !== userId) {
      throw new NotFoundError('Address', dto.addressId);
    }

    const services = await this.loadServices(dto.items.map((i) => i.sku));
    this.assertUrgencyEligible(services, dto.urgencyTier);

    // A service with no up-front price FORCES inspect-first, whatever the
    // client asked for — we must never invent a number for it.
    const forcedByCatalog = services.some(
      (s) => s.pricingModel === 'INSPECTION_FIRST' || s.pricingModel === 'QUOTE_ONLY',
    );
    const pricingMode = dto.inspectFirst || forcedByCatalog ? 'INSPECT_FIRST' : 'UPFRONT';

    const coupon = await this.resolveCoupon(dto.couponCode, now);

    // The visit charge is what the customer risks if they decline the quote.
    const visitCharge = sum(services.map((s) => money(s.visitChargePaise)));

    let estimate: PriceBreakdown | null = null;
    let versionIds: string[] = [];
    if (pricingMode === 'UPFRONT') {
      const resolved = await this.priceRules.resolve(address.city, now);
      versionIds = resolved.versionIds;
      estimate = computePrice(
        {
          serviceLines: this.toPriceLines(dto, services),
          urgencyTier: dto.urgencyTier,
          // E2/E3 never surge — surge is an emergency-tier mechanism.
          surgeMultiplierX100: 100,
          ...(coupon === null ? {} : { coupon }),
        },
        resolved.rules,
        now,
      );
    }

    const booking = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          userId,
          addressId: address.id,
          urgencyTier: dto.urgencyTier,
          pricingMode,
          status: 'DRAFT',
          estimateTotalPaise: estimate === null ? 0n : estimate.totalPaise,
          emergencyFeePaise: 0n,
          priceRuleVersionIds: versionIds,
          ...(coupon === null ? {} : { couponId: coupon.id }),
          ...(dto.scheduledSlotStart === undefined
            ? {}
            : { scheduledSlotStart: dto.scheduledSlotStart }),
          ...(dto.scheduledSlotEnd === undefined ? {} : { scheduledSlotEnd: dto.scheduledSlotEnd }),
          items: {
            create: dto.items.map((item) => {
              const service = services.find((s) => s.sku === item.sku);
              if (service === undefined) throw new NotFoundError('Service', item.sku);
              return {
                serviceId: service.id,
                quantity: item.quantity,
                // Zero on inspect-first: there is genuinely no unit price yet.
                unitPricePaise:
                  pricingMode === 'INSPECT_FIRST' ? 0n : (service.basePricePaise ?? 0n),
                preVisitAnswers: item.preVisitAnswers as object[],
              };
            }),
          },
        },
      });

      // Inspect-first has nothing to charge, so it confirms straight away.
      // Up-front waits for payment. Both moves go through the state machine.
      const target: BookingState =
        pricingMode === 'INSPECT_FIRST' ? 'CONFIRMED' : 'PENDING_PAYMENT';
      bookingMachine.assert('DRAFT', target, { pricingMode });

      return tx.booking.update({ where: { id: created.id }, data: { status: target } });
    });

    this.logger.info({
      event: 'booking.created',
      bookingId: booking.id,
      userId,
      pricingMode,
      urgencyTier: dto.urgencyTier,
      status: booking.status,
      forcedInspectFirst: forcedByCatalog && !dto.inspectFirst,
      estimateTotalPaise: booking.estimateTotalPaise.toString(),
    });

    return this.toView(booking, services, dto, estimate, visitCharge);
  }

  async findForUser(userId: string, bookingId: string): Promise<BookingView> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: { include: { service: true } } },
    });
    if (booking === null) throw new NotFoundError('Booking', bookingId);
    if (booking.userId !== userId) {
      // Don't confirm that someone else's booking exists.
      throw new NotFoundError('Booking', bookingId);
    }

    const services = booking.items.map((i) => i.service);
    const visitCharge = sum(services.map((s) => money(s.visitChargePaise)));

    return {
      id: booking.id,
      status: booking.status,
      urgencyTier: booking.urgencyTier,
      pricingMode: booking.pricingMode,
      scheduledSlotStart: booking.scheduledSlotStart?.toISOString() ?? null,
      scheduledSlotEnd: booking.scheduledSlotEnd?.toISOString() ?? null,
      items: booking.items.map((i) => ({
        sku: i.service.sku,
        name: i.service.name,
        quantity: i.quantity,
        unitPriceLabel: i.unitPricePaise > 0n ? format(money(i.unitPricePaise)) : null,
      })),
      estimate:
        booking.pricingMode === 'INSPECT_FIRST'
          ? null
          : {
              totalPaise: booking.estimateTotalPaise.toString(),
              totalLabel: format(money(booking.estimateTotalPaise)),
              lines: [],
            },
      visitChargePaise: visitCharge.toString(),
      visitChargeLabel: format(visitCharge),
      whatHappensNext: whatHappensNext(booking.status, booking.pricingMode),
      createdAt: booking.createdAt.toISOString(),
    };
  }

  async listForUser(userId: string): Promise<BookingView[]> {
    const rows = await this.prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.findForUser(userId, r.id)));
  }

  /**
   * Customer cancellation. The fee schedule from PLAN §4.3 is applied by the
   * refund path (WO-11); here we only move state and record the reason.
   */
  async cancel(
    userId: string,
    bookingId: string,
    reason: string | undefined,
  ): Promise<BookingView> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (booking === null || booking.userId !== userId)
      throw new NotFoundError('Booking', bookingId);

    bookingMachine.assert(booking.status, 'CANCELLED_BY_USER', {
      pricingMode: booking.pricingMode,
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.booking.update({
        where: { id: bookingId },
        data: { status: 'CANCELLED_BY_USER' },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'CUSTOMER',
          actorId: userId,
          action: 'booking.cancel',
          entityType: 'Booking',
          entityId: bookingId,
          before: { status: booking.status },
          after: { status: 'CANCELLED_BY_USER' },
          ...(reason === undefined ? {} : { reason }),
        },
      });
    });

    this.logger.info({
      event: 'booking.cancelled_by_user',
      bookingId,
      userId,
      fromStatus: booking.status,
    });
    return this.findForUser(userId, bookingId);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async loadServices(skus: string[]): Promise<Service[]> {
    const services = await this.prisma.service.findMany({
      where: { sku: { in: skus }, isActive: true },
    });
    for (const sku of skus) {
      if (!services.some((s) => s.sku === sku)) throw new NotFoundError('Service', sku);
    }
    return services;
  }

  private assertUrgencyEligible(services: Service[], tier: 'E2' | 'E3'): void {
    for (const service of services) {
      if (!service.urgencyEligible.includes(tier)) {
        throw new ConflictError(
          `"${service.name}" cannot be booked for ${tier === 'E2' ? 'same-day' : 'scheduled'} service.`,
          { sku: service.sku, allowed: service.urgencyEligible },
        );
      }
    }
  }

  private toPriceLines(dto: CreateBookingDto, services: Service[]): PriceLineInput[] {
    return dto.items.map((item) => {
      const service = services.find((s) => s.sku === item.sku);
      if (service === undefined) throw new NotFoundError('Service', item.sku);
      return {
        label: service.name,
        unitPricePaise: service.basePricePaise ?? 0n,
        quantity: item.quantity,
        // TODO(ca-review): per-SKU rate from Service.sacCode once mapped.
        gstRatePct: DEFAULT_GST_RATE_PCT,
      };
    });
  }

  private async resolveCoupon(code: string | undefined, now: Date) {
    if (code === undefined) return null;
    const coupon = await this.prisma.coupon.findUnique({ where: { code } });
    if (coupon === null || !coupon.isActive) {
      throw new NotFoundError('Coupon', code);
    }
    if (coupon.validFrom > now || (coupon.validTo !== null && coupon.validTo < now)) {
      throw new ConflictError('That coupon is not valid right now.', { code });
    }
    if (coupon.kind === 'FLAT') {
      if (coupon.flatPaise === null)
        throw new ConflictError('That coupon is misconfigured.', { code });
      return { id: coupon.id, kind: 'FLAT' as const, flatPaise: coupon.flatPaise };
    }
    if (coupon.percent === null) throw new ConflictError('That coupon is misconfigured.', { code });
    return {
      id: coupon.id,
      kind: 'PERCENT' as const,
      percent: coupon.percent,
      ...(coupon.maxDiscountPaise === null ? {} : { maxDiscountPaise: coupon.maxDiscountPaise }),
    };
  }

  private toView(
    booking: Booking,
    services: Service[],
    dto: CreateBookingDto,
    estimate: PriceBreakdown | null,
    visitCharge: Money,
  ): BookingView {
    return {
      id: booking.id,
      status: booking.status,
      urgencyTier: booking.urgencyTier,
      pricingMode: booking.pricingMode,
      scheduledSlotStart: booking.scheduledSlotStart?.toISOString() ?? null,
      scheduledSlotEnd: booking.scheduledSlotEnd?.toISOString() ?? null,
      items: dto.items.map((item) => {
        const service = services.find((s) => s.sku === item.sku);
        return {
          sku: item.sku,
          name: service?.name ?? item.sku,
          quantity: item.quantity,
          unitPriceLabel:
            booking.pricingMode === 'INSPECT_FIRST' || service?.basePricePaise == null
              ? null
              : format(money(service.basePricePaise)),
        };
      }),
      estimate:
        estimate === null
          ? null
          : {
              totalPaise: estimate.totalPaise.toString(),
              totalLabel: format(money(estimate.totalPaise)),
              lines: estimate.lines.map((l) => ({
                code: l.code,
                label: l.label,
                amountPaise: l.amountPaise.toString(),
                amountLabel: format(money(l.amountPaise)),
              })),
            },
      visitChargePaise: visitCharge.toString(),
      visitChargeLabel: format(visitCharge),
      whatHappensNext: whatHappensNext(booking.status, booking.pricingMode),
      createdAt: booking.createdAt.toISOString(),
    };
  }
}

/** Customer-facing copy. Kept beside the states so the two cannot drift. */
export function whatHappensNext(
  status: BookingStatus,
  pricingMode: 'UPFRONT' | 'INSPECT_FIRST',
): string {
  switch (status) {
    case 'DRAFT':
      return 'Your booking is being prepared.';
    case 'PENDING_PAYMENT':
      return 'Pay to confirm your booking. We hold your slot for 15 minutes.';
    case 'EXPIRED':
      return 'This booking expired before payment. Book again whenever you are ready.';
    case 'CONFIRMED':
      return pricingMode === 'INSPECT_FIRST'
        ? 'Confirmed — you pay nothing now. Our expert will inspect, then send you an itemised quote to approve.'
        : 'Confirmed. We are finding the right plumber for you.';
    case 'DISPATCHING':
      return 'We are offering your job to nearby plumbers.';
    case 'FAILED_TO_ASSIGN':
      return 'No plumber was available. Our team is on it and any payment is being refunded.';
    case 'ASSIGNED':
      return 'A plumber is assigned. You will see them set off on the map.';
    case 'EN_ROUTE':
      return 'Your plumber is on the way. Keep your start code handy.';
    case 'ARRIVED':
      return 'Your plumber has arrived and is looking at the problem.';
    case 'DIAGNOSING':
      return 'Your plumber is diagnosing the issue.';
    case 'QUOTE_PENDING':
    case 'QUOTE_REVISED':
      return 'A quote is waiting for you. Nothing starts until you approve it.';
    case 'VISIT_CHARGE_ONLY':
      return 'You declined the quote, so only the visit charge applies.';
    case 'IN_PROGRESS':
      return 'Work is underway.';
    case 'WORK_DONE':
      return 'Work is finished. Please review the photos and pay.';
    case 'PAYMENT_PENDING':
      return 'Awaiting payment to close the job.';
    case 'COMPLETED':
      return 'All done. Your labour warranty starts today.';
    case 'CANCELLED_BY_USER':
      return 'You cancelled this booking.';
    case 'CANCELLED_BY_PARTNER':
      return 'The plumber cancelled. We are finding you another one.';
    case 'NO_SHOW_CUSTOMER':
      return 'Nobody was available at the address.';
    case 'NO_SHOW_PARTNER':
      return 'The plumber did not turn up. We are sorry — support has been alerted.';
    case 'DISPUTED':
      return 'This job is under review by our support team.';
  }
}

/** Re-exported so callers do not import ZERO from two places. */
export const NO_ESTIMATE: Money = ZERO;
