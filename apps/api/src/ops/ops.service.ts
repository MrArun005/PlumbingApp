/**
 * Manual dispatch for ops. Until the auto-dispatch engine lands (WO-09), this
 * is how a confirmed booking becomes a real job — and it stays afterwards as
 * the dispatcher-desk override (ring 4 of the emergency ladder).
 *
 * Creating the Job is the moment the DB-level "one active job per partner"
 * unique index earns its keep: two dispatchers assigning the same plumber at
 * the same instant, one of them loses.
 */
import { randomInt } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type pino from 'pino';
import { ConflictError, NotFoundError, bookingMachine } from '@pipefix/shared';
import { LOGGER, PRISMA } from '../env';

/** 4-digit codes the customer reads aloud — short enough to say over a door. */
function otp(): string {
  return randomInt(0, 10_000).toString().padStart(4, '0');
}

export interface AssignResult {
  jobId: string;
  bookingId: string;
  partnerId: string;
  partnerName: string;
  /** Shown to the CUSTOMER only. The partner must be told it verbally. */
  startOtp: string;
}

@Injectable()
export class OpsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  async assignPartner(
    bookingId: string,
    partnerId: string,
    actorId: string,
  ): Promise<AssignResult> {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (booking === null) throw new NotFoundError('Booking', bookingId);

    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (partner === null) throw new NotFoundError('Partner', partnerId);
    if (partner.status !== 'ACTIVE') {
      throw new ConflictError('That partner is not active.', { status: partner.status });
    }

    // CONFIRMED → DISPATCHING → ASSIGNED, both hops through the machine.
    const ctx = { pricingMode: booking.pricingMode };
    if (booking.status === 'CONFIRMED') {
      bookingMachine.assert('CONFIRMED', 'DISPATCHING', ctx);
      bookingMachine.assert('DISPATCHING', 'ASSIGNED', ctx);
    } else {
      bookingMachine.assert(booking.status, 'ASSIGNED', ctx);
    }

    const startOtp = otp();
    const endOtp = otp();

    try {
      const job = await this.prisma.$transaction(async (tx) => {
        const created = await tx.job.create({
          data: { bookingId, partnerId, status: 'ASSIGNED', startOtp, endOtp },
        });
        await tx.booking.update({ where: { id: bookingId }, data: { status: 'ASSIGNED' } });
        // Append-only timeline — the source of truth for SLA and disputes.
        await tx.jobTimelineEvent.create({
          data: {
            jobId: created.id,
            eventType: 'job.assigned',
            actorType: 'ADMIN',
            actorId,
            payload: { partnerId, manual: true },
          },
        });
        await tx.auditLog.create({
          data: {
            actorType: 'ADMIN',
            actorId,
            action: 'booking.manual_assign',
            entityType: 'Booking',
            entityId: bookingId,
            before: { status: booking.status },
            after: { status: 'ASSIGNED', jobId: created.id, partnerId },
          },
        });
        return created;
      });

      this.logger.info({
        event: 'dispatch.manual_assign',
        bookingId,
        partnerId,
        jobId: job.id,
        actorId,
      });

      return {
        jobId: job.id,
        bookingId,
        partnerId,
        partnerName: partner.name,
        startOtp,
      };
    } catch (e) {
      // The partial unique index rejected a second concurrent active job.
      if (isUniqueViolation(e)) {
        this.logger.warn({ event: 'dispatch.assign_conflict', bookingId, partnerId });
        throw new ConflictError('That partner already has an active job.', { partnerId });
      }
      throw e;
    }
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' && e !== null && 'code' in e && (e as { code?: unknown }).code === 'P2002'
  );
}
