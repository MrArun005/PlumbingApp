/**
 * Auth integration tests — real Postgres, real Redis, real JWTs.
 * Covers OTP lifecycle, rate limiting, replay, refresh rotation + reuse
 * detection, partner gating, and device binding.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { createPrismaClient, type PrismaClient } from '@pipefix/db';
import { TEST_ENV, createTestApp, infraIsUp } from '../test-app';

const up = await infraIsUp();

const CUSTOMER_PHONE = '+919812345001'; // seeded (Asha Nair)
const NEW_PHONE = '+919812349999'; // created by these tests
const PARTNER_PHONE = '+919800000001'; // seeded ACTIVE partner (Ravi Kumar)
const DEVICE_A = 'device-aaa-111';
const DEVICE_B = 'device-bbb-222';

describe.skipIf(!up)('auth API', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let redis: Redis;
  let prisma: PrismaClient;
  let pendingPartnerPhone: string;

  beforeAll(async () => {
    redis = new Redis(TEST_ENV.REDIS_URL);
    prisma = createPrismaClient(TEST_ENV.DATABASE_URL);
    app = await createTestApp();
    http = request(app.getHttpServer());

    pendingPartnerPhone = '+919700000099';
    await prisma.partner.upsert({
      where: { phone: pendingPartnerPhone },
      create: { phone: pendingPartnerPhone, name: 'Pending Test Partner', status: 'PENDING' },
      update: { status: 'PENDING' },
    });
  });

  afterAll(async () => {
    await prisma.partner.deleteMany({ where: { phone: pendingPartnerPhone } });
    await prisma.user.deleteMany({ where: { phone: NEW_PHONE } });
    await prisma.partner.update({ where: { phone: PARTNER_PHONE }, data: { deviceId: null } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  beforeEach(async () => {
    const keys = await redis.keys('otp:*');
    if (keys.length > 0) await redis.del(...keys);
  });

  /** Request an OTP and return the dev-only code. */
  async function getCode(path: string, phone: string): Promise<string> {
    const res = await http.post(path).send({ phone }).expect(200);
    expect(res.body.devCode).toMatch(/^\d{6}$/);
    return res.body.devCode as string;
  }

  // ── OTP request ──────────────────────────────────────────────────────────

  it('issues a 6-digit code for a valid Indian mobile', async () => {
    const res = await http.post('/auth/otp/request').send({ phone: CUSTOMER_PHONE }).expect(200);
    expect(res.body.expiresInSec).toBe(300);
    expect(res.body.devCode).toMatch(/^\d{6}$/);
  });

  it('rejects a malformed phone number at the boundary', async () => {
    const res = await http.post('/auth/otp/request').send({ phone: '9876543210' }).expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('rate-limits repeated OTP requests for the same number', async () => {
    for (let i = 0; i < 3; i += 1) {
      await http.post('/auth/otp/request').send({ phone: CUSTOMER_PHONE }).expect(200);
    }
    const res = await http.post('/auth/otp/request').send({ phone: CUSTOMER_PHONE }).expect(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.body.details.retryAfterSec).toBeGreaterThan(0);
  });

  it('never stores the raw code in Redis', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const stored = await redis.get(`otp:CUSTOMER:${CUSTOMER_PHONE}`);
    expect(stored).not.toBeNull();
    expect(stored).not.toContain(code);
  });

  // ── OTP verify ───────────────────────────────────────────────────────────

  it('logs in an existing customer and returns a token pair', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code })
      .expect(200);
    expect(res.body.user.name).toBe('Asha Nair');
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.accessExpiresInSec).toBe(900);
  });

  it('self-registers a new customer on first verified login', async () => {
    const code = await getCode('/auth/otp/request', NEW_PHONE);
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone: NEW_PHONE, code, name: 'Nikhil Rao' })
      .expect(200);
    expect(res.body.user.name).toBe('Nikhil Rao');
    expect(await prisma.user.findUnique({ where: { phone: NEW_PHONE } })).not.toBeNull();
  });

  it('rejects a wrong code', async () => {
    await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code: '000000' })
      .expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('a code is single-use — replay is rejected', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    await http.post('/auth/otp/verify').send({ phone: CUSTOMER_PHONE, code }).expect(200);
    await http.post('/auth/otp/verify').send({ phone: CUSTOMER_PHONE, code }).expect(401);
  });

  it('burns the code after too many wrong attempts', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    for (let i = 0; i < 5; i += 1) {
      await http
        .post('/auth/otp/verify')
        .send({ phone: CUSTOMER_PHONE, code: '111111' })
        .expect(401);
    }
    // even the CORRECT code no longer works
    await http.post('/auth/otp/verify').send({ phone: CUSTOMER_PHONE, code }).expect(401);
  });

  it('refuses login for a blocked account', async () => {
    await prisma.user.update({ where: { phone: CUSTOMER_PHONE }, data: { isBlocked: true } });
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const res = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code })
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    await prisma.user.update({ where: { phone: CUSTOMER_PHONE }, data: { isBlocked: false } });
  });

  // ── refresh rotation ─────────────────────────────────────────────────────

  it('rotates a refresh token into a fresh pair', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const login = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code })
      .expect(200);

    const rotated = await http
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);
    expect(rotated.body.accessToken).toBeTypeOf('string');
  });

  it('detects refresh reuse and revokes the whole session family', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const login = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code })
      .expect(200);

    const rotated = await http
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    // replay the SPENT token → rejected, and the family is torn down
    await http.post('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
    // therefore the token issued by the legitimate rotation is dead too
    await http.post('/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
  });

  it('logout revokes every refresh token for the caller', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const login = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code })
      .expect(200);

    await http
      .post('/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(204);
    await http.post('/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(401);
  });

  it('requires a bearer token on protected endpoints', async () => {
    const res = await http.post('/auth/logout').expect(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('rejects a garbage bearer token', async () => {
    await http.post('/auth/logout').set('Authorization', 'Bearer not.a.jwt').expect(401);
  });

  // ── partner auth ─────────────────────────────────────────────────────────

  it('logs in an ACTIVE partner and binds the device', async () => {
    const code = await getCode('/partner/auth/otp/request', PARTNER_PHONE);
    const res = await http
      .post('/partner/auth/otp/verify')
      .send({ phone: PARTNER_PHONE, code, deviceId: DEVICE_A })
      .expect(200);
    expect(res.body.partner.name).toBe('Ravi Kumar');
    expect(res.body.partner.skillTier).toBe('L3');

    const row = await prisma.partner.findUniqueOrThrow({ where: { phone: PARTNER_PHONE } });
    expect(row.deviceId).toBe(DEVICE_A);
  });

  it('refuses a PENDING partner with an explanatory message', async () => {
    const code = await getCode('/partner/auth/otp/request', pendingPartnerPhone);
    const res = await http
      .post('/partner/auth/otp/verify')
      .send({ phone: pendingPartnerPhone, code, deviceId: DEVICE_A })
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(res.body.message).toContain('verification is still in progress');
  });

  it('does not reveal whether an unknown number is a partner', async () => {
    const res = await http
      .post('/partner/auth/otp/request')
      .send({ phone: '+919000000000' })
      .expect(200);
    expect(res.body.devCode).toBeUndefined(); // no code was actually issued
    expect(res.body.expiresInSec).toBe(300); // response shape is identical
  });

  it('signing in on a new device invalidates the old device session', async () => {
    const codeA = await getCode('/partner/auth/otp/request', PARTNER_PHONE);
    const sessionA = await http
      .post('/partner/auth/otp/verify')
      .send({ phone: PARTNER_PHONE, code: codeA, deviceId: DEVICE_A })
      .expect(200);

    const codeB = await getCode('/partner/auth/otp/request', PARTNER_PHONE);
    await http
      .post('/partner/auth/otp/verify')
      .send({ phone: PARTNER_PHONE, code: codeB, deviceId: DEVICE_B })
      .expect(200);

    // device A's refresh token is gone…
    await http
      .post('/partner/auth/refresh')
      .send({ refreshToken: sessionA.body.refreshToken })
      .expect(401);
    // …and its access token is refused by the device-binding check
    await http
      .post('/partner/auth/logout')
      .set('Authorization', `Bearer ${sessionA.body.accessToken}`)
      .expect(401);
  });

  it('a customer token cannot be used on partner endpoints', async () => {
    const code = await getCode('/auth/otp/request', CUSTOMER_PHONE);
    const login = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code })
      .expect(200);
    const res = await http
      .post('/partner/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});
