/**
 * Public catalog — browsable without a session (SEO + pre-login browsing).
 * The city comes from a header or query param and defaults to the launch city.
 */
import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { z } from 'zod';
import { parseOrThrow } from '@pipefix/shared';
import { ENV, type ApiEnv } from '../env';
import { Public } from '../auth/auth.guard';
import { CatalogService } from './catalog.service';

const listQuerySchema = z.object({
  city: z.string().trim().min(1).optional(),
  category: z
    .string()
    .trim()
    .regex(/^[A-Z]{3,4}$/, 'Category codes look like LEAK or DRN')
    .optional(),
});

const skuParamSchema = z.object({
  sku: z.string().regex(/^PLB-[A-Z]{3,4}-\d{3}$/, 'Expected a SKU like PLB-LEAK-007'),
});

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    @Inject(ENV) private readonly env: ApiEnv,
  ) {}

  private resolveCity(headerCity: string | undefined, queryCity: string | undefined): string {
    return queryCity ?? headerCity ?? this.env.DEFAULT_CITY;
  }

  @Public()
  @Get('categories')
  async categories(@Headers('x-city') headerCity: string | undefined, @Query() query: unknown) {
    const q = parseOrThrow(listQuerySchema, query, 'GET /catalog/categories');
    const city = this.resolveCity(headerCity, q.city);
    return { city, categories: await this.catalog.listCategories(city) };
  }

  @Public()
  @Get('services')
  async services(@Headers('x-city') headerCity: string | undefined, @Query() query: unknown) {
    const q = parseOrThrow(listQuerySchema, query, 'GET /catalog/services');
    const city = this.resolveCity(headerCity, q.city);
    return { city, services: await this.catalog.listServices(city, q.category) };
  }

  @Public()
  @Get('services/:sku')
  async service(
    @Headers('x-city') headerCity: string | undefined,
    @Param() params: unknown,
    @Query() query: unknown,
  ) {
    const p = parseOrThrow(skuParamSchema, params, 'GET /catalog/services/:sku');
    const q = parseOrThrow(listQuerySchema, query, 'GET /catalog/services/:sku');
    const city = this.resolveCity(headerCity, q.city);
    return { city, service: await this.catalog.getService(city, p.sku) };
  }
}
