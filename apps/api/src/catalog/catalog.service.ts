/**
 * Catalog reads — city-scoped (BUILD-PROMPT rule 5) and Redis-cached.
 *
 * City scoping is not optional: `CityServiceOverride` can deactivate a SKU or
 * change its price per city, so a query without a city would serve the wrong
 * catalog. Every public method here takes `city` as its first argument, and
 * the cache key always includes it.
 *
 * IMPORTANT — pricing surface: `INSPECTION_FIRST` and `QUOTE_ONLY` services
 * deliberately expose NO job price. `priceDisplay` tells the client exactly
 * what it may render, so no client ever invents a number.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient, Service } from '@pipefix/db';
import type Redis from 'ioredis';
import type pino from 'pino';
import { NotFoundError, format, money } from '@pipefix/shared';
import { CATALOG_CACHE_VERSION } from './catalog.constants';
import { ENV, LOGGER, PRISMA, REDIS, type ApiEnv } from '../env';

/** What the client is allowed to show for a service's price. */
export type PriceDisplayKind = 'EXACT' | 'FROM' | 'PER_UNIT' | 'INSPECTION_FIRST' | 'QUOTE_ONLY';

export interface PriceDisplay {
  kind: PriceDisplayKind;
  /** Absent for INSPECTION_FIRST / QUOTE_ONLY — there is no job price yet. */
  amountPaise?: string;
  amountLabel?: string;
  /** Charged only if the customer declines the on-site quote. */
  visitChargePaise: string;
  visitChargeLabel: string;
  /** Ready-to-render copy, e.g. "From ₹349" or "Price after inspection". */
  headline: string;
  /** One-line explanation of what the customer commits to. */
  note: string;
}

export interface ServiceView {
  sku: string;
  name: string;
  shortDesc: string;
  longDesc: string | null;
  categoryCode: string;
  estDurationMin: number;
  skillTier: string;
  materialsPolicy: string;
  warrantyDays: number;
  urgencyEligible: string[];
  requiredTools: string[];
  preVisitQuestions: unknown;
  /** True when the plumber must inspect before any price exists. */
  inspectFirst: boolean;
  price: PriceDisplay;
}

export interface CategoryView {
  code: string;
  name: string;
  iconKey: string | null;
  serviceCount: number;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(LOGGER) private readonly logger: pino.Logger,
  ) {}

  private key(city: string, suffix: string): string {
    return `catalog:${CATALOG_CACHE_VERSION}:${city}:${suffix}`;
  }

  private async cached<T>(cacheKey: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.redis.get(cacheKey);
    if (hit !== null) return JSON.parse(hit) as T;
    const fresh = await load();
    await this.redis.set(cacheKey, JSON.stringify(fresh), 'EX', this.env.CATALOG_CACHE_TTL_SEC);
    return fresh;
  }

  async listCategories(city: string): Promise<CategoryView[]> {
    return this.cached(this.key(city, 'categories'), async () => {
      const overrides = await this.cityOverrides(city);
      const categories = await this.prisma.serviceCategory.findMany({
        orderBy: { sortOrder: 'asc' },
        include: { services: { where: { isActive: true }, select: { id: true } } },
      });
      return categories
        .map((c) => ({
          code: c.code,
          name: c.name,
          iconKey: c.iconKey,
          serviceCount: c.services.filter((s) => overrides.get(s.id)?.isActive !== false).length,
        }))
        .filter((c) => c.serviceCount > 0);
    });
  }

  async listServices(city: string, categoryCode?: string): Promise<ServiceView[]> {
    return this.cached(this.key(city, `services:${categoryCode ?? 'all'}`), async () => {
      const overrides = await this.cityOverrides(city);
      const services = await this.prisma.service.findMany({
        where: {
          isActive: true,
          ...(categoryCode === undefined ? {} : { category: { code: categoryCode } }),
        },
        include: { category: { select: { code: true, sortOrder: true } } },
        orderBy: [{ category: { sortOrder: 'asc' } }, { sku: 'asc' }],
      });

      return services
        .filter((s) => overrides.get(s.id)?.isActive !== false)
        .map((s) => this.toView(s, s.category.code, overrides.get(s.id)?.basePricePaise ?? null));
    });
  }

  async getService(city: string, sku: string): Promise<ServiceView> {
    const service = await this.prisma.service.findUnique({
      where: { sku },
      include: { category: { select: { code: true } } },
    });
    if (service === null || !service.isActive) throw new NotFoundError('Service', sku);

    const override = await this.prisma.cityServiceOverride.findUnique({
      where: { city_serviceId: { city, serviceId: service.id } },
    });
    if (override !== null && !override.isActive) throw new NotFoundError('Service', sku);

    return this.toView(service, service.category.code, override?.basePricePaise ?? null);
  }

  /** Invalidate every cached catalog page for a city (called by admin writes). */
  async invalidate(city: string): Promise<void> {
    const pattern = this.key(city, '*');
    const keys: string[] = [];
    const stream = this.redis.scanStream({ match: pattern, count: 200 });
    for await (const batch of stream as AsyncIterable<string[]>) keys.push(...batch);
    if (keys.length > 0) await this.redis.del(...keys);
    this.logger.info({ event: 'catalog.cache.invalidated', city, keys: keys.length });
  }

  private async cityOverrides(city: string) {
    const rows = await this.prisma.cityServiceOverride.findMany({ where: { city } });
    return new Map(rows.map((o) => [o.serviceId, o]));
  }

  private toView(
    service: Service,
    categoryCode: string,
    overridePaise: bigint | null,
  ): ServiceView {
    const basePaise = overridePaise ?? service.basePricePaise;
    const inspectFirst =
      service.pricingModel === 'INSPECTION_FIRST' || service.pricingModel === 'QUOTE_ONLY';

    return {
      sku: service.sku,
      name: service.name,
      shortDesc: service.shortDesc,
      longDesc: service.longDesc,
      categoryCode,
      estDurationMin: service.estDurationMin,
      skillTier: service.skillTier,
      materialsPolicy: service.materialsPolicy,
      warrantyDays: service.warrantyDays,
      urgencyEligible: service.urgencyEligible,
      requiredTools: service.requiredTools,
      preVisitQuestions: service.preVisitQuestions,
      inspectFirst,
      price: buildPriceDisplay(service, basePaise),
    };
  }
}

/**
 * Turns a service + resolved base price into exactly what the UI may render.
 * Exported so the web/app layer and its tests share one source of truth.
 */
export function buildPriceDisplay(service: Service, basePaise: bigint | null): PriceDisplay {
  const visit = money(service.visitChargePaise);
  const visitCharge = { visitChargePaise: visit.toString(), visitChargeLabel: format(visit) };

  switch (service.pricingModel) {
    case 'INSPECTION_FIRST':
      // The seeded base price IS the inspection fee for this model.
      return {
        kind: 'INSPECTION_FIRST',
        ...visitCharge,
        headline: 'Price after inspection',
        note:
          basePaise === null
            ? 'Our expert inspects first, then shares an itemised quote for your approval.'
            : `Inspection ${format(money(basePaise))}, adjusted into the final bill. You approve the quote before any work starts.`,
      };
    case 'QUOTE_ONLY':
      return {
        kind: 'QUOTE_ONLY',
        ...visitCharge,
        headline: 'Price after site visit',
        note: 'No price is shown up-front. You receive an itemised quote on site and approve it before work begins.',
      };
    case 'PER_UNIT':
      return {
        kind: 'PER_UNIT',
        amountPaise: (basePaise ?? 0n).toString(),
        amountLabel: format(money(basePaise ?? 0n)),
        ...visitCharge,
        headline: `${format(money(basePaise ?? 0n))} ${service.unitLabel ?? 'per unit'}`,
        note: 'Final amount depends on the quantity confirmed on site.',
      };
    case 'FROM':
      return {
        kind: 'FROM',
        amountPaise: (basePaise ?? 0n).toString(),
        amountLabel: format(money(basePaise ?? 0n)),
        ...visitCharge,
        headline: `From ${format(money(basePaise ?? 0n))}`,
        note: 'Starting price. Anything extra is quoted on site for your approval.',
      };
    case 'HOURLY':
      return {
        kind: 'PER_UNIT',
        amountPaise: (basePaise ?? 0n).toString(),
        amountLabel: format(money(basePaise ?? 0n)),
        ...visitCharge,
        headline: `${format(money(basePaise ?? 0n))} per hour`,
        note: 'Billed by time spent, confirmed with you before work starts.',
      };
    case 'FIXED':
    case 'SUBSCRIPTION':
      return {
        kind: 'EXACT',
        amountPaise: (basePaise ?? 0n).toString(),
        amountLabel: format(money(basePaise ?? 0n)),
        ...visitCharge,
        headline: format(money(basePaise ?? 0n)),
        note:
          service.pricingModel === 'SUBSCRIPTION'
            ? 'Annual plan price.'
            : 'Fixed price for this service. Materials, if any, are quoted separately.',
      };
  }
}
