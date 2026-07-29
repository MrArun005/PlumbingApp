import { Module, type Provider } from '@nestjs/common';
import Redis from 'ioredis';
import { createPrismaClient, type PrismaClient } from '@pipefix/db';
import { ENV, LOGGER, PRISMA, REDIS, type ApiEnv } from './env';
import { createLogger } from './logging/logger';
import { AuthController, PartnerAuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CustomerGuard, PartnerGuard } from './auth/auth.guard';
import { OtpService } from './auth/otp.service';
import { TokenService } from './auth/token.service';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { HealthController } from './health/health.controller';
import { BookingsController } from './bookings/bookings.controller';
import { BookingsService } from './bookings/bookings.service';
import { PriceRulesService } from './bookings/price-rules.service';
import { IdempotencyService } from './common/idempotency.service';
import { OpsController } from './ops/ops.controller';
import { OpsService } from './ops/ops.service';
import { WebhooksController } from './payments/webhooks.controller';
import { PAYMENT_GATEWAY, PaymentsService, StubGateway } from './payments/payments.service';
import { CustomerQuotesController, PartnerJobsController } from './jobs/jobs.controller';
import { JobsService } from './jobs/jobs.service';
import { QuotesService } from './jobs/quotes.service';

/**
 * Infrastructure is provided from validated env — nothing reads process.env
 * below this point, and tests can swap any of these three providers.
 */
export function infraProviders(env: ApiEnv): Provider[] {
  return [
    { provide: ENV, useValue: env },
    { provide: LOGGER, useValue: createLogger(env.LOG_LEVEL) },
    { provide: PRISMA, useFactory: (): PrismaClient => createPrismaClient(env.DATABASE_URL) },
    { provide: REDIS, useFactory: (): Redis => new Redis(env.REDIS_URL) },
  ];
}

@Module({})
export class AppModule {
  static forEnv(env: ApiEnv) {
    @Module({
      controllers: [
        AuthController,
        PartnerAuthController,
        CatalogController,
        BookingsController,
        CustomerQuotesController,
        PartnerJobsController,
        WebhooksController,
        OpsController,
        HealthController,
      ],
      providers: [
        ...infraProviders(env),
        OtpService,
        TokenService,
        AuthService,
        CatalogService,
        BookingsService,
        PriceRulesService,
        PaymentsService,
        IdempotencyService,
        OpsService,
        JobsService,
        QuotesService,
        // The real Razorpay client swaps in here once live keys + KYC exist.
        // Guarded so a stub can never be selected in production by accident.
        {
          provide: PAYMENT_GATEWAY,
          useFactory: () => {
            if (env.NODE_ENV === 'production') {
              throw new Error(
                'No production payment gateway is configured. Wire Razorpay before deploying to production.',
              );
            }
            return new StubGateway();
          },
        },
        // Guards are applied PER CONTROLLER, never globally: this API serves two
        // different audiences, and a global guard cannot know which audience a
        // route belongs to (a customer-only global guard would 403 every partner
        // route before its own guard ran). Each controller declares its own.
        CustomerGuard,
        PartnerGuard,
      ],
    })
    class ConfiguredAppModule {}
    return ConfiguredAppModule;
  }
}
