import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '@pipefix/shared';
import { Caller, CustomerGuard } from '../auth/auth.guard';
import type { AccessClaims } from '../auth/token.service';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.service';
import { PaymentsService } from '../payments/payments.service';
import { BookingsService } from './bookings.service';
import { cancelBookingSchema, createBookingSchema } from './bookings.dto';

@UseGuards(CustomerGuard)
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookings: BookingsService,
    private readonly payments: PaymentsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * Create a booking. Requires an Idempotency-Key so a retry on a flaky mobile
   * connection cannot produce two bookings (and two charges).
   */
  @Post()
  async create(
    @Caller() caller: AccessClaims,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    const dto = parseOrThrow(createBookingSchema, body, 'POST /bookings');
    return this.idempotency.run('POST /bookings', `${caller.sub}:${key}`, body, () =>
      this.bookings.create(caller.sub, dto, new Date()),
    );
  }

  @Get()
  async list(@Caller() caller: AccessClaims) {
    return { bookings: await this.bookings.listForUser(caller.sub) };
  }

  @Get(':id')
  async get(@Caller() caller: AccessClaims, @Param('id') id: string) {
    return { booking: await this.bookings.findForUser(caller.sub, id) };
  }

  /** Start payment. Inspect-first bookings reject this — nothing to pay yet. */
  @Post(':id/pay')
  async pay(
    @Caller() caller: AccessClaims,
    @Param('id') id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    return this.idempotency.run(
      'POST /bookings/:id/pay',
      `${caller.sub}:${id}:${key}`,
      { bookingId: id },
      () => this.payments.createIntent(caller.sub, id),
    );
  }

  @Post(':id/cancel')
  async cancel(@Caller() caller: AccessClaims, @Param('id') id: string, @Body() body: unknown) {
    const dto = parseOrThrow(cancelBookingSchema, body ?? {}, 'POST /bookings/:id/cancel');
    return { booking: await this.bookings.cancel(caller.sub, id, dto.reason) };
  }
}
