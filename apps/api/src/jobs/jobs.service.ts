/**
 * The on-site job lifecycle, driven by the partner app.
 *
 * Everything here funnels through `jobMachine`, so the guards (geofence, OTP,
 * quote approval, PPE proof, after-photos, settled payment) are enforced in one
 * place rather than re-implemented per endpoint. This service's job is to
 * ASSEMBLE the guard context honestly — read the real distance from PostGIS,
 * the real photo counts, the real quote status — and let the machine decide.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { BookingStatus, JobStatus, PrismaClient } from '@pipefix/db';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  format,
  jobMachine,
  money,
  type JobContext,
  type JobState,
} from '@pipefix/shared';
import type pino from 'pino';
import { LOGGER, PRISMA } from '../env';
import type { OtpBodyDto, PhotoDto } from './jobs.dto';

/** SKUs whose work happens in a sewer, manhole or septic chamber. */
const CONFINED_SPACE_SKUS = new Set(['PLB-DRN-005', 'PLB-DRN-008', 'PLB-DRN-009']);

export interface PartnerJobView {
  jobId: string;
  bookingId: string;
  status: JobStatus;
  urgencyTier: string;
  pricingMode: string;
  customerName: string;
  /** So the plumber can tap to call. */
  customerPhone: string;
  scheduledSlotStart: string | null;
  completedAt: string | null;
  /** What was actually billed, once the job is done. */
  finalTotalLabel: string | null;
  address: {
    line1: string;
    line2: string | null;
    landmark: string | null;
    pincode: string;
    floor: number | null;
    liftAvailable: boolean;
    gateInstructions: string | null;
  };
  services: { sku: string; name: string; quantity: number; requiredTools: string[] }[];
  /** True when this job may not start without PPE photo proof. */
  requiresPpeProof: boolean;
  /** Null on inspect-first — the partner must raise a quote instead. */
  estimateLabel: string | null;
  /** What the partner should do next, in plain words. */
  nextAction: string;
}

@Injectable()
export class JobsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  /**
   * The plumber's own job list.
   *
   * `scope` decides what comes back:
   *   'active' (default) — today's work, oldest first, so the top of the list is
   *                        what to do next
   *   'history'          — finished and cancelled jobs, newest first, for
   *                        "what did I do for this customer last time?"
   */
  async listForPartner(
    partnerId: string,
    scope: 'active' | 'history' = 'active',
    customerPhone?: string,
  ): Promise<PartnerJobView[]> {
    const finished: JobStatus[] = ['COMPLETED', 'CANCELLED', 'NO_SHOW_CUSTOMER', 'NO_SHOW_PARTNER'];
    const jobs = await this.prisma.job.findMany({
      where: {
        partnerId,
        status: scope === 'history' ? { in: finished } : { notIn: finished },
        ...(customerPhone === undefined ? {} : { booking: { user: { phone: customerPhone } } }),
      },
      orderBy: scope === 'history' ? { createdAt: 'desc' } : { createdAt: 'asc' },
      take: scope === 'history' ? 50 : undefined,
      include: {
        booking: {
          include: {
            user: { select: { name: true, phone: true } },
            address: true,
            items: { include: { service: true } },
          },
        },
      },
    });

    return jobs.map((job) => {
      const services = job.booking.items.map((i) => i.service);
      return {
        jobId: job.id,
        bookingId: job.bookingId,
        status: job.status,
        urgencyTier: job.booking.urgencyTier,
        pricingMode: job.booking.pricingMode,
        customerName: job.booking.user.name,
        // The plumber needs to be able to phone the customer and navigate to
        // them — those are the two things he actually does with this screen.
        customerPhone: job.booking.user.phone,
        scheduledSlotStart: job.booking.scheduledSlotStart?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        finalTotalLabel:
          job.booking.finalTotalPaise === null ? null : format(money(job.booking.finalTotalPaise)),
        address: {
          line1: job.booking.address.line1,
          line2: job.booking.address.line2,
          landmark: job.booking.address.landmark,
          pincode: job.booking.address.pincode,
          floor: job.booking.address.floor,
          liftAvailable: job.booking.address.liftAvailable,
          gateInstructions: job.booking.address.gateInstructions,
        },
        services: services.map((s) => ({
          sku: s.sku,
          name: s.name,
          quantity: job.booking.items.find((i) => i.serviceId === s.id)?.quantity ?? 1,
          requiredTools: s.requiredTools,
        })),
        requiresPpeProof: services.some((s) => CONFINED_SPACE_SKUS.has(s.sku)),
        estimateLabel:
          job.booking.pricingMode === 'INSPECT_FIRST'
            ? null
            : format(money(job.booking.estimateTotalPaise)),
        nextAction: partnerNextAction(job.status, job.booking.pricingMode),
      };
    });
  }

  /** Partner sets off. Begins the live location stream in the customer app. */
  async start(partnerId: string, jobId: string): Promise<{ status: JobStatus }> {
    return this.transition(partnerId, jobId, 'EN_ROUTE', {}, 'job.started');
  }

  /**
   * Check in at the door. Requires BOTH the geofence and the customer's code —
   * this is what makes "arrived" a fact rather than a tap.
   */
  async arrive(partnerId: string, jobId: string, dto: OtpBodyDto): Promise<{ status: JobStatus }> {
    const job = await this.loadOwnJob(partnerId, jobId);

    const distance =
      dto.lat === undefined || dto.lng === undefined
        ? undefined
        : await this.distanceToAddress(job.booking.addressId, dto.lat, dto.lng);

    return this.transition(
      partnerId,
      jobId,
      'ARRIVED',
      {
        ...(distance === undefined ? {} : { distanceToAddressM: distance }),
        startOtpValid: dto.otp === job.startOtp,
      },
      'job.arrived',
      { distanceToAddressM: distance },
    );
  }

  async beginDiagnosis(partnerId: string, jobId: string): Promise<{ status: JobStatus }> {
    return this.transition(partnerId, jobId, 'DIAGNOSING', {}, 'job.diagnosing');
  }

  /**
   * Start the actual work. The machine blocks this if a quote is unapproved, or
   * if it is sewer work without PPE proof.
   */
  async beginWork(partnerId: string, jobId: string): Promise<{ status: JobStatus }> {
    const ctx = await this.buildContext(partnerId, jobId);
    return this.transition(partnerId, jobId, 'IN_PROGRESS', ctx, 'job.work_started');
  }

  /** Mark work finished. Blocked without an after-photo above ₹1,000. */
  async finishWork(partnerId: string, jobId: string): Promise<{ status: JobStatus }> {
    const ctx = await this.buildContext(partnerId, jobId);
    return this.transition(partnerId, jobId, 'WORK_DONE', ctx, 'job.work_done');
  }

  /** Close the job. Requires the customer's end code and settled payment. */
  async complete(
    partnerId: string,
    jobId: string,
    dto: OtpBodyDto,
  ): Promise<{ status: JobStatus }> {
    const job = await this.loadOwnJob(partnerId, jobId);
    const ctx = await this.buildContext(partnerId, jobId);
    return this.transition(
      partnerId,
      jobId,
      'COMPLETED',
      { ...ctx, endOtpValid: dto.otp === job.endOtp },
      'job.completed',
    );
  }

  async addPhoto(partnerId: string, jobId: string, dto: PhotoDto): Promise<{ photoId: string }> {
    await this.loadOwnJob(partnerId, jobId);
    const photo = await this.prisma.jobPhoto.create({
      data: {
        jobId,
        phase: dto.phase,
        fileKey: dto.fileKey,
        takenAt: new Date(),
      },
    });
    await this.prisma.jobTimelineEvent.create({
      data: {
        jobId,
        eventType: dto.isPpeProof ? 'job.ppe_proof_uploaded' : 'job.photo_added',
        actorType: 'PARTNER',
        actorId: partnerId,
        payload: { phase: dto.phase, fileKey: dto.fileKey, isPpeProof: dto.isPpeProof },
      },
    });
    this.logger.info({
      event: 'job.photo_added',
      jobId,
      partnerId,
      phase: dto.phase,
      isPpeProof: dto.isPpeProof,
    });
    return { photoId: photo.id };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async loadOwnJob(partnerId: string, jobId: string) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: { booking: true },
    });
    if (job === null) throw new NotFoundError('Job', jobId);
    if (job.partnerId !== partnerId) {
      throw new ForbiddenError('This job is not assigned to you.');
    }
    return job;
  }

  /**
   * Straight-line distance in metres, computed by PostGIS against the stored
   * address point. Returns undefined when the address has no coordinates, which
   * the geofence guard treats as "cannot confirm" rather than as a pass.
   */
  private async distanceToAddress(
    addressId: string,
    lat: number,
    lng: number,
  ): Promise<number | undefined> {
    const rows = await this.prisma.$queryRaw<{ metres: number | null }[]>`
      SELECT ST_Distance(location, ST_GeogFromText(${`POINT(${lng} ${lat})`})) AS metres
      FROM "Address" WHERE id = ${addressId}`;
    const metres = rows[0]?.metres;
    return metres === null || metres === undefined ? undefined : Number(metres);
  }

  /** Assemble the real state of the world for the machine's guards. */
  private async buildContext(partnerId: string, jobId: string): Promise<JobContext> {
    const job = await this.prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      include: {
        booking: { include: { items: { include: { service: true } }, payments: true } },
        quotes: { include: { approval: true }, orderBy: { createdAt: 'desc' } },
        photos: true,
      },
    });

    const latestQuote = job.quotes[0];
    const approvedQuote = job.quotes.find((q) => q.status === 'APPROVED');
    const isConfinedSpace = job.booking.items.some((i) => CONFINED_SPACE_SKUS.has(i.service.sku));
    const ppeProof = await this.prisma.jobTimelineEvent.findFirst({
      where: { jobId, eventType: 'job.ppe_proof_uploaded' },
    });

    // The billable value: an approved quote supersedes the booking estimate.
    const finalTotal = approvedQuote?.totalPaise ?? job.booking.estimateTotalPaise;

    return {
      quoteExists: latestQuote !== undefined,
      quoteApproved: approvedQuote !== undefined,
      isConfinedSpaceWork: isConfinedSpace,
      ppePhotoUploaded: ppeProof !== null,
      afterPhotoCount: job.photos.filter((p) => p.phase === 'AFTER').length,
      finalTotalPaise: money(finalTotal),
      paymentSettled: job.booking.payments.some(
        (p) => p.status === 'CAPTURED' || p.method === 'CASH',
      ),
    };
  }

  /**
   * One place that moves a job: assert via the machine, write the row, append a
   * timeline event, and mirror the status onto the booking so the customer app
   * sees the same truth.
   */
  private async transition(
    partnerId: string,
    jobId: string,
    to: JobState,
    ctx: JobContext,
    eventType: string,
    payload: Record<string, unknown> = {},
  ): Promise<{ status: JobStatus }> {
    const job = await this.loadOwnJob(partnerId, jobId);

    jobMachine.assert(job.status, to, ctx);

    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({
        where: { id: jobId },
        data: {
          status: to,
          ...(to === 'EN_ROUTE' ? { startedAt: new Date() } : {}),
          ...(to === 'ARRIVED' ? { arrivedAt: new Date() } : {}),
          ...(to === 'COMPLETED' ? { completedAt: new Date() } : {}),
        },
      });
      // Append-only: never updated, never deleted. SLA and disputes read this.
      await tx.jobTimelineEvent.create({
        data: {
          jobId,
          eventType,
          actorType: 'PARTNER',
          actorId: partnerId,
          payload: payload as object,
        },
      });
      const bookingStatus = bookingStatusForJob(to);
      if (bookingStatus !== null) {
        await tx.booking.update({ where: { id: job.bookingId }, data: { status: bookingStatus } });
      }
      if (to === 'EN_ROUTE') {
        await tx.partner.update({ where: { id: partnerId }, data: { onlineStatus: 'ON_JOB' } });
      }
      if (to === 'COMPLETED') {
        await tx.partner.update({ where: { id: partnerId }, data: { onlineStatus: 'ONLINE' } });
      }
    });

    this.logger.info({ event: eventType, jobId, partnerId, from: job.status, to, ...payload });
    return { status: to };
  }
}

/**
 * Job status → booking status. The booking is what the customer polls, so the
 * two must not drift. WORK_DONE moves the booking to PAYMENT_PENDING because
 * that is the customer's next action.
 */
export function bookingStatusForJob(jobStatus: JobState): BookingStatus | null {
  switch (jobStatus) {
    case 'EN_ROUTE':
      return 'EN_ROUTE';
    case 'ARRIVED':
      return 'ARRIVED';
    case 'DIAGNOSING':
      return 'DIAGNOSING';
    case 'QUOTE_PENDING':
      return 'QUOTE_PENDING';
    case 'QUOTE_REVISED':
      return 'QUOTE_REVISED';
    case 'VISIT_CHARGE_ONLY':
      return 'VISIT_CHARGE_ONLY';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'WORK_DONE':
      return 'PAYMENT_PENDING';
    case 'COMPLETED':
      return 'COMPLETED';
    default:
      return null; // side-states are handled by their own flows
  }
}

/** Partner-facing guidance, kept next to the states it describes. */
export function partnerNextAction(status: JobStatus, pricingMode: string): string {
  switch (status) {
    case 'ASSIGNED':
      return 'Tap start when you set off.';
    case 'EN_ROUTE':
      return 'On arrival, ask the customer for their 4-digit start code.';
    case 'ARRIVED':
      return 'Take a before photo and start your diagnosis.';
    case 'DIAGNOSING':
      return pricingMode === 'INSPECT_FIRST'
        ? 'Send the customer an itemised quote — this booking has no price yet.'
        : 'Send a quote if the work differs from the booking, otherwise begin work.';
    case 'QUOTE_PENDING':
    case 'QUOTE_REVISED':
      return 'Waiting for the customer to approve your quote. Do not start work yet.';
    case 'IN_PROGRESS':
      return 'Add an after photo when you finish.';
    case 'WORK_DONE':
      return 'Collect payment, then close the job with the customer end code.';
    case 'VISIT_CHARGE_ONLY':
      return 'Quote declined — collect the visit charge and close the job.';
    default:
      return 'No action needed.';
  }
}

/** Exported for tests and for the quotes service. */
export function isConfinedSpaceSku(sku: string): boolean {
  return CONFINED_SPACE_SKUS.has(sku);
}

/** Material lines above this need a bill photo (ops spot-audit 5% weekly). */
export const MATERIAL_BILL_PHOTO_THRESHOLD_PAISE = 50_000n;

export function materialNeedsBillPhoto(unitPricePaise: bigint, quantity: number): boolean {
  return unitPricePaise * BigInt(quantity) > MATERIAL_BILL_PHOTO_THRESHOLD_PAISE;
}

/** Guard against a partner quoting an absurd amount by fat-fingering paise. */
export const MAX_QUOTE_TOTAL_PAISE = 50_000_000n; // ₹5,00,000

export function assertQuoteWithinSanityLimit(totalPaise: bigint): void {
  if (totalPaise > MAX_QUOTE_TOTAL_PAISE) {
    throw new ConflictError(
      `That total (${format(money(totalPaise))}) is above the limit for an in-app quote. Contact the ops desk for large jobs.`,
      { limitPaise: MAX_QUOTE_TOTAL_PAISE.toString() },
    );
  }
}
