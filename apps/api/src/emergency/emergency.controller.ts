import { Body, Controller, Get, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '@pipefix/shared';
import { Caller, CustomerGuard, Public } from '../auth/auth.guard';
import type { AccessClaims } from '../auth/token.service';
import { IdempotencyService, requireIdempotencyKey } from '../common/idempotency.service';
import { EmergencyService } from './emergency.service';
import { SafetyScriptsService } from './safety-scripts.service';
import { acknowledgeSafetySchema, createEmergencySchema } from './emergency.dto';

@UseGuards(CustomerGuard)
@Controller('emergency')
export class EmergencyController {
  constructor(
    private readonly emergency: EmergencyService,
    private readonly safety: SafetyScriptsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * The SOS fast path. Idempotent: a panicking customer double-tapping the red
   * button must not create two emergencies (and two ₹499 holds).
   */
  @Post()
  async create(
    @Caller() caller: AccessClaims,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    const key = requireIdempotencyKey(idempotencyKey);
    const dto = parseOrThrow(createEmergencySchema, body, 'POST /emergency');
    return this.idempotency.run('POST /emergency', `${caller.sub}:${key}`, body, () =>
      this.emergency.intake(caller.sub, dto, new Date()),
    );
  }

  @Post(':id/safety-acknowledged')
  async acknowledge(
    @Caller() caller: AccessClaims,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const dto = parseOrThrow(
      acknowledgeSafetySchema,
      body,
      'POST /emergency/:id/safety-acknowledged',
    );
    return this.emergency.acknowledgeSafety(
      caller.sub,
      id,
      dto.safetyScriptVersion,
      dto.couldNotComply,
      new Date(),
    );
  }

  /**
   * The permanent "where is my main valve?" style guides. Public because they are
   * genuinely useful before anyone books — and per PLAN §3.3 a good acquisition
   * asset in their own right.
   */
  @Public()
  @Get('safety/:issueType')
  async safetyCard(@Param('issueType') issueType: string) {
    return { card: await this.safety.cardFor(issueType.toUpperCase()) };
  }
}
