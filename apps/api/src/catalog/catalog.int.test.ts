/**
 * Catalog API integration tests — real Postgres, real Redis, real Nest app.
 * The central assertion: services that need an inspection NEVER leak a job
 * price to the client.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { TEST_ENV, createTestApp, infraIsUp } from '../test-app';

const up = await infraIsUp();

describe.skipIf(!up)('catalog API', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    // Start from a cold cache so cache-population is exercised.
    const redis = new Redis(TEST_ENV.REDIS_URL);
    const keys = await redis.keys('catalog:*');
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();

    app = await createTestApp();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists categories without a session, defaulting to the launch city', async () => {
    const res = await http.get('/catalog/categories').expect(200);
    expect(res.body.city).toBe('Bengaluru');
    expect(res.body.categories.length).toBe(10);
    const leak = res.body.categories.find((c: { code: string }) => c.code === 'LEAK');
    expect(leak).toMatchObject({ name: 'Leak & Pipe Repair', serviceCount: 9 });
  });

  it('serves the same payload from cache on the second call', async () => {
    const first = await http.get('/catalog/categories').expect(200);
    const second = await http.get('/catalog/categories').expect(200);
    expect(second.body).toEqual(first.body);
  });

  it('lists all active services', async () => {
    const res = await http.get('/catalog/services').expect(200);
    expect(res.body.services.length).toBe(74);
  });

  it('filters services by category', async () => {
    const res = await http.get('/catalog/services?category=DRN').expect(200);
    expect(res.body.services.length).toBe(9);
    for (const s of res.body.services) expect(s.categoryCode).toBe('DRN');
  });

  it('rejects a malformed category code at the boundary', async () => {
    const res = await http.get('/catalog/services?category=not-a-code').expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('shows an exact price for a FIXED service', async () => {
    const res = await http.get('/catalog/services/PLB-DRN-001').expect(200);
    expect(res.body.service.price).toMatchObject({
      kind: 'EXACT',
      amountPaise: '34900',
      headline: '₹349.00',
    });
    expect(res.body.service.inspectFirst).toBe(false);
  });

  it('shows a "From" price for a FROM service', async () => {
    const res = await http.get('/catalog/services/PLB-LEAK-007').expect(200);
    expect(res.body.service.price.kind).toBe('FROM');
    expect(res.body.service.price.headline).toBe('From ₹899.00');
    expect(res.body.service.urgencyEligible).toContain('E0');
  });

  it('shows a per-unit price with its unit label', async () => {
    const res = await http.get('/catalog/services/PLB-BTH-001').expect(200);
    expect(res.body.service.price.kind).toBe('PER_UNIT');
    expect(res.body.service.price.headline).toBe('₹199.00 per tap');
  });

  // ── the inspect-first guarantee ──────────────────────────────────────────

  it('QUOTE_ONLY services expose NO job price at all', async () => {
    const res = await http.get('/catalog/services/PLB-PIP-001').expect(200);
    const price = res.body.service.price;
    expect(res.body.service.inspectFirst).toBe(true);
    expect(price.kind).toBe('QUOTE_ONLY');
    expect(price.amountPaise).toBeUndefined();
    expect(price.amountLabel).toBeUndefined();
    expect(price.headline).toBe('Price after site visit');
    expect(price.note).toContain('approve');
  });

  it('INSPECTION_FIRST services expose only the inspection charge', async () => {
    const res = await http.get('/catalog/services/PLB-LEAK-004').expect(200);
    const price = res.body.service.price;
    expect(res.body.service.inspectFirst).toBe(true);
    expect(price.kind).toBe('INSPECTION_FIRST');
    expect(price.amountPaise).toBeUndefined();
    expect(price.headline).toBe('Price after inspection');
    expect(price.note).toContain('₹599.00');
  });

  it('no inspect-first service leaks an amount anywhere in the list payload', async () => {
    const res = await http.get('/catalog/services').expect(200);
    const inspectFirst = res.body.services.filter((s: { inspectFirst: boolean }) => s.inspectFirst);
    expect(inspectFirst.length).toBeGreaterThan(0);
    for (const s of inspectFirst) {
      expect(s.price.amountPaise).toBeUndefined();
      expect(s.price.amountLabel).toBeUndefined();
      expect(s.price.kind === 'INSPECTION_FIRST' || s.price.kind === 'QUOTE_ONLY').toBe(true);
    }
  });

  it('carries pre-visit questions through for diagnostic SKUs', async () => {
    const res = await http.get('/catalog/services/PLB-DRN-004').expect(200);
    const questions = res.body.service.preVisitQuestions as unknown[];
    expect(questions.length).toBe(4);
    expect(JSON.stringify(questions)).toContain('overflowing');
  });

  it('404s for an unknown SKU and 400s for a malformed one', async () => {
    const missing = await http.get('/catalog/services/PLB-LEAK-999').expect(404);
    expect(missing.body.code).toBe('NOT_FOUND');
    const malformed = await http.get('/catalog/services/nonsense').expect(400);
    expect(malformed.body.code).toBe('VALIDATION_FAILED');
  });

  it('honours the x-city header and the city query param', async () => {
    const header = await http.get('/catalog/categories').set('x-city', 'Mysuru').expect(200);
    expect(header.body.city).toBe('Mysuru');
    const query = await http.get('/catalog/categories?city=Hyderabad').expect(200);
    expect(query.body.city).toBe('Hyderabad');
  });

  it('reports infra health', async () => {
    const res = await http.get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up', redis: 'up' });
  });
});
