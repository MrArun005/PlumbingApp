/**
 * Ops/dispatcher endpoints.
 *
 * TODO(WO-09): these are guarded by the partner guard as a placeholder so they
 * are not open to the world. A proper ADMIN subject type + role check lands
 * with the admin console — tracked in docs/STATE.md as a known gap.
 */
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow, trimmedString } from '@pipefix/shared';
import { Caller, PartnerGuard } from '../auth/auth.guard';
import type { AccessClaims } from '../auth/token.service';
import { OpsService } from './ops.service';

const assignSchema = z.object({
  bookingId: trimmedString,
  partnerId: trimmedString,
});

@UseGuards(PartnerGuard)
@Controller('ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Post('assign')
  async assign(@Caller() caller: AccessClaims, @Body() body: unknown) {
    const dto = parseOrThrow(assignSchema, body, 'POST /ops/assign');
    return { assignment: await this.ops.assignPartner(dto.bookingId, dto.partnerId, caller.sub) };
  }
}
