/**
 * Login flows for both audiences.
 *
 * Customers self-register: a verified phone with no User row creates one.
 * Partners do NOT — they must be onboarded and ACTIVE first (a PENDING or
 * SUSPENDED plumber cannot take jobs, so they cannot hold a session either).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type pino from 'pino';
import { ForbiddenError, UnauthorizedError } from '@pipefix/shared';
import { LOGGER, PRISMA } from '../env';
import { OtpService } from './otp.service';
import { TokenService, type TokenPair } from './token.service';

export interface CustomerSession extends TokenPair {
  user: { id: string; phone: string; name: string };
}

export interface PartnerSession extends TokenPair {
  partner: { id: string; phone: string; name: string; skillTier: string; onlineStatus: string };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(LOGGER) private readonly logger: pino.Logger,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
  ) {}

  async requestCustomerOtp(phone: string) {
    return this.otp.request('CUSTOMER', phone);
  }

  async requestPartnerOtp(phone: string) {
    // Don't reveal whether the number is a registered partner (enumeration),
    // but don't send a code to a stranger either — issue only for known rows.
    const partner = await this.prisma.partner.findUnique({ where: { phone } });
    if (partner === null) {
      this.logger.info({ event: 'auth.partner.otp_unknown_phone', phone });
      return { expiresInSec: 300 };
    }
    return this.otp.request('PARTNER', phone);
  }

  async verifyCustomer(phone: string, code: string, name?: string): Promise<CustomerSession> {
    await this.otp.verify('CUSTOMER', phone, code);

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing !== null && existing.isBlocked) {
      this.logger.warn({ event: 'auth.customer.blocked_login', userId: existing.id });
      throw new ForbiddenError('This account is blocked. Please contact support.');
    }

    const user =
      existing ??
      (await this.prisma.user.create({
        data: { phone, name: name ?? 'PipeFix customer' },
      }));
    if (existing === null) {
      this.logger.info({ event: 'auth.customer.registered', userId: user.id });
    }

    const pair = await this.tokens.issue({ sub: user.id, typ: 'CUSTOMER' });
    this.logger.info({ event: 'auth.customer.logged_in', userId: user.id });
    return { ...pair, user: { id: user.id, phone: user.phone, name: user.name } };
  }

  async verifyPartner(phone: string, code: string, deviceId: string): Promise<PartnerSession> {
    await this.otp.verify('PARTNER', phone, code);

    const partner = await this.prisma.partner.findUnique({ where: { phone } });
    if (partner === null)
      throw new UnauthorizedError('This number is not registered as a partner.');
    if (partner.status !== 'ACTIVE') {
      this.logger.warn({
        event: 'auth.partner.inactive_login',
        partnerId: partner.id,
        status: partner.status,
      });
      throw new ForbiddenError(
        partner.status === 'PENDING'
          ? 'Your verification is still in progress. We will notify you once it is complete.'
          : 'Your partner account is not active. Please contact partner support.',
      );
    }

    // Device binding: logging in on a new device invalidates other sessions,
    // so one account cannot be shared across phones.
    if (partner.deviceId !== null && partner.deviceId !== deviceId) {
      await this.tokens.revokeAll('PARTNER', partner.id);
      this.logger.info({ event: 'auth.partner.device_rebound', partnerId: partner.id });
    }
    await this.prisma.partner.update({ where: { id: partner.id }, data: { deviceId } });

    const pair = await this.tokens.issue({ sub: partner.id, typ: 'PARTNER', did: deviceId });
    this.logger.info({ event: 'auth.partner.logged_in', partnerId: partner.id });
    return {
      ...pair,
      partner: {
        id: partner.id,
        phone: partner.phone,
        name: partner.name,
        skillTier: partner.skillTier,
        onlineStatus: partner.onlineStatus,
      },
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    return this.tokens.rotate(refreshToken);
  }
}
