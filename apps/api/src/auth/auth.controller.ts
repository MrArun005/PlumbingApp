import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { parseOrThrow } from '@pipefix/shared';
import { Caller, CustomerGuard, Public, PartnerGuard } from './auth.guard';
import type { AccessClaims } from './token.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import {
  otpRequestSchema,
  otpVerifySchema,
  partnerOtpVerifySchema,
  refreshSchema,
} from './auth.dto';

/** Customer auth. Login routes are @Public(); everything else needs a session. */
@UseGuards(CustomerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    const dto = parseOrThrow(otpRequestSchema, body, 'POST /auth/otp/request');
    return this.auth.requestCustomerOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown) {
    const dto = parseOrThrow(otpVerifySchema, body, 'POST /auth/otp/verify');
    return this.auth.verifyCustomer(dto.phone, dto.code, dto.name);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    const dto = parseOrThrow(refreshSchema, body, 'POST /auth/refresh');
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Caller() caller: AccessClaims): Promise<void> {
    await this.tokens.revokeAll(caller.typ, caller.sub);
  }
}

@Controller('partner/auth')
export class PartnerAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(@Body() body: unknown) {
    const dto = parseOrThrow(otpRequestSchema, body, 'POST /partner/auth/otp/request');
    return this.auth.requestPartnerOtp(dto.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown) {
    const dto = parseOrThrow(partnerOtpVerifySchema, body, 'POST /partner/auth/otp/verify');
    return this.auth.verifyPartner(dto.phone, dto.code, dto.deviceId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() body: unknown) {
    const dto = parseOrThrow(refreshSchema, body, 'POST /partner/auth/refresh');
    return this.auth.refresh(dto.refreshToken);
  }

  @UseGuards(PartnerGuard)
  @Post('logout')
  @HttpCode(204)
  async logout(@Caller() caller: AccessClaims): Promise<void> {
    await this.tokens.revokeAll(caller.typ, caller.sub);
  }
}
