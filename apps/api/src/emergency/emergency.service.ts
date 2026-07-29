/**
 * The emergency tier — E0 SOS (≤30 min) and E1 Urgent (≤2 h).
 *
 * Two things about the ordering here matter more than anything else:
 *
 *  1. The safety card is returned IMMEDIATELY with the intake response, and
 *     dispatch is marked as started at the same moment. The customer's reading
 *     time must not cost them ETA — the spec is explicit that the broadcast
 *     fires in parallel with the safety card, not after it.
 *
 *  2. The surge multiplier is FROZEN onto the booking at creation. Whatever
 *     happens to demand afterwards, the customer pays the multiplier they were
 *     shown.
 *
 * The GAS_SMELL path is different on purpose: we do not dispatch a plumber into
 * a suspected gas leak. The customer is told to leave and call 1906 (India's LPG
 * emergency helpline) — sending our own technician first would be dangerous.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, UrgencyTier } from '@pipefix/db';
import { computePrice } from '@pipefix/pricing';
import { ConflictError, NotFoundError, bookingMachine, format, money } from '@pipefix/shared';
import type pino from 'pino';
import { LOGGER, PRISMA } from '../env';
import { DEFAULT_GST_RATE_PCT, PriceRulesService } from '../bookings/price-rules.service';
import { SafetyScriptsService, type SafetyCard } from './safety-scripts.service';
import { SurgeService } from './surge.service';
import type { CreateEmergencyDto } from './emergency.dto';

/** Which SKU handles each emergency, and at which tier. */
const ISSUE_ROUTING: Record<string, { sku: string; tier: UrgencyTier }> = {
  BURST_PIPE: { sku: 'PLB-LEAK-007', tier: 'E0' },
  FLOODING: { sku: 'PLB-LEAK-007', tier: 'E0' },
  SEWAGE_BACKFLOW: { sku: 'PLB-DRN-008', tier: 'E0' },
  GEYSER_LEAK: { sku: 'PLB-GYS-007', tier: 'E0' },
  TANK_OVERFLOW: { sku: 'PLB-TNK-009', tier: 'E0' },
  NO_WATER: { sku: 'PLB-TNK-009', tier: 'E1' },
  OTHER: { sku: 'PLB-LEAK-003', tier: 'E1' },
};

/** Issues we must NOT send a plumber to as the first response. */
const DO_NOT_DISPATCH: Record<string, { title: string; instructions: string; helpline: string }> = {
  GAS_SMELL: {
    title: 'Do not book — call the gas helpline first',
    instructions: [
      'Do not switch anything on or off, including lights.',
      'Open windows and doors, leave the property, and take everyone with you.',
      'Once you are outside, call the LPG emergency helpline.',
      '',
      'We are not sending a plumber yet. A suspected gas leak needs the gas',
      'emergency service first — call us afterwards and we will help with any',
      'plumbing work that is still needed.',
    ].join('\n'),
    helpline: '1906',
  },
};

export interface EmergencyIntakeResult {
  /** Null when we deliberately refused to dispatch (see DO_NOT_DISPATCH). */
  bookingId: string | null;
  emergencyRequestId: string | null;
  urgencyTier: UrgencyTier | null;
  /** Shown BEFORE assignment; dispatch is already running in parallel. */
  safetyCard: SafetyCard;
  /** Absolute deadline the money-back guarantee is measured against. */
  slaTargetAt: string | null;
  slaMinutes: number | null;
  emergencyFeeLabel: string | null;
  surgeMultiplierX100: number | null;
  estimateLabel: string | null;
  /** Set when we refused to dispatch; contains what to do instead. */
  doNotDispatch: { title: string; instructions: string; helpline: string } | null;
  whatHappensNext: string;
}

/** Arrival SLA per emergency tier, in minutes. */
export const EMERGENCY_SLA_MINUTES: Record<'E0' | 'E1', number> = { E0: 30, E1: 120 };

@Injectable()
export class EmergencyService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
    private readonly safety: SafetyScriptsService,
    private readonly surge: SurgeService,
    private readonly priceRules: PriceRulesService,
  ) {}

  async intake(userId: string, dto: CreateEmergencyDto, now: Date): Promise<EmergencyIntakeResult> {
    const safetyCard = await this.safety.cardFor(dto.issueType);

    // Refuse to dispatch where dispatching first would be dangerous.
    const refusal = DO_NOT_DISPATCH[dto.issueType];
    if (refusal !== undefined) {
      this.logger.warn({
        event: 'emergency.refused_dangerous_issue',
        userId,
        issueType: dto.issueType,
      });
      return {
        bookingId: null,
        emergencyRequestId: null,
        urgencyTier: null,
        safetyCard: { ...safetyCard, bodyMarkdown: refusal.instructions, title: refusal.title },
        slaTargetAt: null,
        slaMinutes: null,
        emergencyFeeLabel: null,
        surgeMultiplierX100: null,
        estimateLabel: null,
        doNotDispatch: refusal,
        whatHappensNext: `Call ${refusal.helpline} now. We are not dispatching a plumber for a suspected gas leak.`,
      };
    }

    const address = await this.prisma.address.findUnique({ where: { id: dto.addressId } });
    if (address === null || address.userId !== userId) {
      throw new NotFoundError('Address', dto.addressId);
    }

    const routing = ISSUE_ROUTING[dto.issueType];
    if (routing === undefined) throw new ConflictError('That emergency type is not supported.');

    const service = await this.prisma.service.findUnique({ where: { sku: routing.sku } });
    if (service === null || !service.isActive) {
      // A missing routing SKU is a configuration failure, not a customer error.
      this.logger.error({ event: 'emergency.routing_sku_missing', sku: routing.sku });
      throw new ConflictError('We cannot take this emergency right now. Please call support.');
    }

    // AMC Plus: zero emergency fee and a lower surge cap — the whole pitch.
    const amc = await this.activeAmcPlan(userId, now);

    const zoneKey = address.pincode;
    const surgeX100 = await this.effectiveSurge(zoneKey, amc?.surgeCapX100 ?? null, now);

    const resolved = await this.priceRules.resolve(address.city, now);
    const breakdown = computePrice(
      {
        serviceLines: [
          {
            label: service.name,
            unitPricePaise: service.basePricePaise ?? 0n,
            quantity: 1,
            gstRatePct: DEFAULT_GST_RATE_PCT,
          },
        ],
        urgencyTier: routing.tier,
        surgeMultiplierX100: surgeX100,
        ...(amc === null
          ? {}
          : {
              amc: {
                repairDiscountPct: amc.repairDiscountPct,
                zeroEmergencyFee: amc.zeroEmergencyFee,
                ...(amc.surgeCapX100 === null ? {} : { surgeCapX100: amc.surgeCapX100 }),
              },
            }),
      },
      resolved.rules,
      now,
    );

    const slaMinutes = EMERGENCY_SLA_MINUTES[routing.tier === 'E0' ? 'E0' : 'E1'];
    const slaTargetAt = new Date(now.getTime() + slaMinutes * 60 * 1000);

    const { booking, emergencyRequest } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.booking.create({
        data: {
          userId,
          addressId: address.id,
          urgencyTier: routing.tier,
          pricingMode: 'UPFRONT',
          status: 'DRAFT',
          estimateTotalPaise: breakdown.totalPaise,
          // Frozen: demand may move, the customer's agreed multiplier may not.
          surgeMultiplierX100: breakdown.meta.surgeAppliedX100,
          emergencyFeePaise: breakdown.meta.emergencyFeePaise,
          priceRuleVersionIds: resolved.versionIds,
          items: {
            create: [
              {
                serviceId: service.id,
                quantity: 1,
                unitPricePaise: service.basePricePaise ?? 0n,
                preVisitAnswers: dto.note === undefined ? [] : [{ note: dto.note }],
              },
            ],
          },
        },
      });

      // Emergency skips the payment wait: the pre-auth is collected in parallel
      // (WO-11), and holding dispatch for it would burn the SLA.
      bookingMachine.assert('DRAFT', 'PENDING_PAYMENT', { pricingMode: 'UPFRONT' });
      await tx.booking.update({ where: { id: created.id }, data: { status: 'PENDING_PAYMENT' } });

      const request = await tx.emergencyRequest.create({
        data: {
          bookingId: created.id,
          issueType: dto.issueType,
          safetyScriptVersion: safetyCard.version,
          mediaKeys: dto.mediaKeys,
          slaTargetAt,
        },
      });

      return { booking: created, emergencyRequest: request };
    });

    this.logger.info({
      event: 'emergency.intake',
      bookingId: booking.id,
      emergencyRequestId: emergencyRequest.id,
      userId,
      issueType: dto.issueType,
      urgencyTier: routing.tier,
      surgeMultiplierX100: breakdown.meta.surgeAppliedX100,
      emergencyFeePaise: breakdown.meta.emergencyFeePaise.toString(),
      slaTargetAt: slaTargetAt.toISOString(),
      safetyScriptVersion: safetyCard.version,
      safetyExpertReviewed: safetyCard.isExpertReviewed,
      amcPlan: amc?.code ?? null,
    });

    return {
      bookingId: booking.id,
      emergencyRequestId: emergencyRequest.id,
      urgencyTier: routing.tier,
      safetyCard,
      slaTargetAt: slaTargetAt.toISOString(),
      slaMinutes,
      emergencyFeeLabel: format(money(breakdown.meta.emergencyFeePaise)),
      surgeMultiplierX100: breakdown.meta.surgeAppliedX100,
      estimateLabel: format(money(breakdown.totalPaise)),
      doNotDispatch: null,
      whatHappensNext:
        routing.tier === 'E0'
          ? `Follow the safety steps. We are contacting plumbers now and aim to have someone with you within ${slaMinutes} minutes.`
          : `Follow the safety steps. We are contacting plumbers now and aim to arrive within ${slaMinutes / 60} hours.`,
    };
  }

  /** Records that the customer read (or could not follow) the safety card. */
  async acknowledgeSafety(
    userId: string,
    emergencyRequestId: string,
    version: number,
    couldNotComply: boolean,
    now: Date,
  ): Promise<{ acknowledgedAt: string }> {
    const request = await this.prisma.emergencyRequest.findUnique({
      where: { id: emergencyRequestId },
      include: { booking: { select: { userId: true } } },
    });
    if (request === null || request.booking.userId !== userId) {
      throw new NotFoundError('EmergencyRequest', emergencyRequestId);
    }

    await this.prisma.emergencyRequest.update({
      where: { id: emergencyRequestId },
      data: { safetyAcknowledgedAt: now, safetyScriptVersion: version },
    });

    this.logger.info({
      event: 'emergency.safety_acknowledged',
      emergencyRequestId,
      userId,
      version,
      couldNotComply,
    });
    return { acknowledgedAt: now.toISOString() };
  }

  /** AMC plan of the customer's active subscription, if any. */
  private async activeAmcPlan(userId: string, now: Date) {
    const subscription = await this.prisma.aMCSubscription.findFirst({
      where: { userId, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gte: now } },
      include: { plan: true },
    });
    return subscription?.plan ?? null;
  }

  /** Zone surge, additionally capped for AMC members. */
  private async effectiveSurge(
    zoneKey: string,
    amcCapX100: number | null,
    now: Date,
  ): Promise<number> {
    const zoneSurge = await this.surge.currentMultiplierX100(zoneKey, now);
    return amcCapX100 === null ? zoneSurge : Math.min(zoneSurge, amcCapX100);
  }
}
