import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '@pipefix/shared';
import { Caller, CustomerGuard, PartnerGuard } from '../auth/auth.guard';
import type { AccessClaims } from '../auth/token.service';
import { JobsService } from './jobs.service';
import { QuotesService } from './quotes.service';
import { createQuoteSchema, declineQuoteSchema, otpBodySchema, photoSchema } from './jobs.dto';

/** Partner app: the on-site job flow. */
@UseGuards(PartnerGuard)
@Controller('partner/jobs')
export class PartnerJobsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly quotes: QuotesService,
  ) {}

  @Get()
  async list(@Caller() caller: AccessClaims) {
    return { jobs: await this.jobs.listForPartner(caller.sub) };
  }

  @Post(':id/start')
  @HttpCode(200)
  async start(@Caller() caller: AccessClaims, @Param('id') id: string) {
    return this.jobs.start(caller.sub, id);
  }

  /** Requires the customer's 4-digit code AND being inside the 100 m geofence. */
  @Post(':id/arrive')
  @HttpCode(200)
  async arrive(@Caller() caller: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(otpBodySchema, body, 'POST /partner/jobs/:id/arrive');
    return this.jobs.arrive(caller.sub, id, dto);
  }

  @Post(':id/diagnose')
  @HttpCode(200)
  async diagnose(@Caller() caller: AccessClaims, @Param('id') id: string) {
    return this.jobs.beginDiagnosis(caller.sub, id);
  }

  /** The itemised on-site quote. For inspect-first jobs this IS the price. */
  @Post(':id/quote')
  async quote(@Caller() caller: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(createQuoteSchema, body, 'POST /partner/jobs/:id/quote');
    return { quote: await this.quotes.create(caller.sub, id, dto, new Date()) };
  }

  @Post(':id/photos')
  async photo(@Caller() caller: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(photoSchema, body, 'POST /partner/jobs/:id/photos');
    return this.jobs.addPhoto(caller.sub, id, dto);
  }

  /** Blocked by the machine if a quote is unapproved or PPE proof is missing. */
  @Post(':id/begin-work')
  @HttpCode(200)
  async beginWork(@Caller() caller: AccessClaims, @Param('id') id: string) {
    return this.jobs.beginWork(caller.sub, id);
  }

  /** Blocked without an AFTER photo when the job is worth over ₹1,000. */
  @Post(':id/finish-work')
  @HttpCode(200)
  async finishWork(@Caller() caller: AccessClaims, @Param('id') id: string) {
    return this.jobs.finishWork(caller.sub, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  async complete(@Caller() caller: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(otpBodySchema, body, 'POST /partner/jobs/:id/complete');
    return this.jobs.complete(caller.sub, id, dto);
  }
}

/** Customer app: seeing and deciding on quotes. */
@UseGuards(CustomerGuard)
@Controller('bookings/:bookingId/quotes')
export class CustomerQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  async list(@Caller() caller: AccessClaims, @Param('bookingId') bookingId: string) {
    return { quotes: await this.quotes.listForBooking(caller.sub, bookingId) };
  }

  @Post(':quoteId/approve')
  @HttpCode(200)
  async approve(@Caller() caller: AccessClaims, @Param('quoteId') quoteId: string) {
    return this.quotes.approve(caller.sub, quoteId);
  }

  @Post(':quoteId/decline')
  @HttpCode(200)
  async decline(
    @Caller() caller: AccessClaims,
    @Param('quoteId') quoteId: string,
    @Body() body: unknown,
  ) {
    const dto = parseOrThrow(declineQuoteSchema, body ?? {}, 'POST .../decline');
    return this.quotes.decline(caller.sub, quoteId, dto.reason);
  }
}
