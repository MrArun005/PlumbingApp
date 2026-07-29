/**
 * Booking flow integration tests — real Postgres, real Redis, real state
 * machine, stub payment gateway.
 *
 * The WO-05 done criterion is the "books → pays (webhook) → ASSIGNED" test at
 * the bottom. The inspect-first suite proves the requirement that no amount is
 * ever quoted up front for services priced on site.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { createPrismaClient, type PrismaClient } from '@pipefix/db';
import { TEST_ENV, createTestApp, infraIsUp } from '../test-app';

const up = await infraIsUp();

// Dedicated fixtures, created and torn down by this file. Sharing the seeded
// customer/partner with the auth tests made the two files fight over the same
// rows and OTP keys.
const CUSTOMER_PHONE = '+919888800011';
const PARTNER_PHONE = '+919888800022';
const DEVICE = 'device-booking-tests';

let keySeq = 0;
const nextKey = (): string => `test-key-${Date.now()}-${(keySeq += 1)}`;

describe.skipIf(!up)('booking flow', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaClient;
  let redis: Redis;
  let token: string;
  let partnerToken: string;
  let addressId: string;
  let userId: string;
  const createdBookingIds: string[] = [];

  beforeAll(async () => {
    redis = new Redis(TEST_ENV.REDIS_URL);
    prisma = createPrismaClient(TEST_ENV.DATABASE_URL);
    app = await createTestApp();
    http = request(app.getHttpServer());

    // Own fixtures: a customer with an address in a serviceable zone, and an
    // ACTIVE L3 partner certified for everything these tests book.
    const user = await prisma.user.upsert({
      where: { phone: CUSTOMER_PHONE },
      create: { phone: CUSTOMER_PHONE, name: 'Booking Test Customer' },
      update: {},
    });
    const existingAddress = await prisma.address.findFirst({ where: { userId: user.id } });
    const address =
      existingAddress ??
      (await prisma.address.create({
        data: {
          userId: user.id,
          label: 'Home',
          line1: '9, 5th Cross',
          line2: 'Koramangala',
          pincode: '560095',
          city: 'Bengaluru',
          isDefault: true,
        },
      }));
    await prisma.$executeRaw`UPDATE "Address" SET location = ST_GeogFromText('POINT(77.622 12.934)') WHERE id = ${address.id}`;

    await prisma.partner.upsert({
      where: { phone: PARTNER_PHONE },
      create: {
        phone: PARTNER_PHONE,
        name: 'Booking Test Partner',
        status: 'ACTIVE',
        skillTier: 'L3',
        emergencyOptIn: true,
      },
      update: { status: 'ACTIVE', skillTier: 'L3', deviceId: null },
    });

    // Customer session
    const req = await http.post('/auth/otp/request').send({ phone: CUSTOMER_PHONE }).expect(200);
    const login = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code: req.body.devCode })
      .expect(200);
    token = login.body.accessToken;
    userId = login.body.user.id;

    // Partner session (stands in for an ops user on /ops/assign — see the
    // TODO in ops.controller.ts about a real ADMIN subject type)
    const preq = await http
      .post('/partner/auth/otp/request')
      .send({ phone: PARTNER_PHONE })
      .expect(200);
    const plogin = await http
      .post('/partner/auth/otp/verify')
      .send({ phone: PARTNER_PHONE, code: preq.body.devCode, deviceId: DEVICE })
      .expect(200);
    partnerToken = plogin.body.accessToken;

    addressId = address.id;
  });

  afterAll(async () => {
    // This file owns its fixture user and partner outright, so clean up by
    // OWNER rather than by a hand-maintained id list — that way a test that
    // creates a booking without registering its id cannot leak rows into the
    // next run (which is exactly what happened while writing these tests).
    const ours = [
      ...(
        await prisma.booking.findMany({
          where: { user: { phone: CUSTOMER_PHONE } },
          select: { id: true },
        })
      ).map((b) => b.id),
      ...createdBookingIds, // plus the deliberately-foreign booking
    ];

    await prisma.jobTimelineEvent.deleteMany({ where: { job: { bookingId: { in: ours } } } });
    await prisma.job.deleteMany({ where: { bookingId: { in: ours } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: ours } } });
    await prisma.bookingItem.deleteMany({ where: { bookingId: { in: ours } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ours } } });
    await prisma.booking.deleteMany({ where: { id: { in: ours } } });
    await prisma.idempotencyRecord.deleteMany({ where: { key: { contains: 'test-key-' } } });
    await prisma.job.deleteMany({ where: { partner: { phone: PARTNER_PHONE } } });
    await prisma.partner.deleteMany({ where: { phone: PARTNER_PHONE } });
    await prisma.address.deleteMany({ where: { user: { phone: CUSTOMER_PHONE } } });
    await prisma.user.deleteMany({ where: { phone: CUSTOMER_PHONE } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  /** Create a booking, remember its id for cleanup, return the response body. */
  async function book(payload: Record<string, unknown>, expectStatus = 201) {
    const res = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send(payload)
      .expect(expectStatus);
    if (res.body.id !== undefined) createdBookingIds.push(res.body.id);
    return res.body;
  }

  const SAME_DAY_FIXED = {
    addressId: '',
    items: [{ sku: 'PLB-DRN-001', quantity: 1 }],
    urgencyTier: 'E2' as const,
  };

  // ── up-front pricing ─────────────────────────────────────────────────────

  it('creates an up-front booking with a full priced estimate', async () => {
    const body = await book({ ...SAME_DAY_FIXED, addressId });
    expect(body.pricingMode).toBe('UPFRONT');
    expect(body.status).toBe('PENDING_PAYMENT');
    // ₹349 + 18% GST = ₹411.82
    expect(body.estimate.totalPaise).toBe('41182');
    expect(body.estimate.totalLabel).toBe('₹411.82');
    expect(body.whatHappensNext).toContain('Pay to confirm');
  });

  it('returns every price line labelled for the customer to read', async () => {
    const body = await book({ ...SAME_DAY_FIXED, addressId });
    const codes = body.estimate.lines.map((l: { code: string }) => l.code);
    expect(codes).toContain('ITEM');
    expect(codes).toContain('GST');
    for (const line of body.estimate.lines) {
      expect(line.label.length).toBeGreaterThan(0);
      expect(line.amountLabel).toMatch(/^-?₹/);
    }
  });

  it('applies a coupon to the estimate', async () => {
    const body = await book({ ...SAME_DAY_FIXED, addressId, couponCode: 'WELCOME100' });
    const coupon = body.estimate.lines.find((l: { code: string }) => l.code === 'COUPON');
    expect(coupon.amountPaise).toBe('-10000'); // ₹100 off
    expect(BigInt(body.estimate.totalPaise)).toBeLessThan(41182n);
  });

  it('rejects an unknown coupon', async () => {
    const res = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ ...SAME_DAY_FIXED, addressId, couponCode: 'NOPE' })
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  // ── inspect-first pricing (the requirement) ──────────────────────────────

  it('an inspect-first booking quotes NO amount and needs no payment', async () => {
    const body = await book({ ...SAME_DAY_FIXED, addressId, inspectFirst: true });
    expect(body.pricingMode).toBe('INSPECT_FIRST');
    expect(body.estimate).toBeNull();
    expect(body.status).toBe('CONFIRMED'); // nothing to pay, so straight to confirmed
    expect(body.items[0].unitPriceLabel).toBeNull();
    expect(body.whatHappensNext).toContain('pay nothing now');
    expect(body.whatHappensNext).toContain('itemised quote');
  });

  it('still tells the customer the visit charge they risk by declining', async () => {
    const body = await book({ ...SAME_DAY_FIXED, addressId, inspectFirst: true });
    expect(BigInt(body.visitChargePaise)).toBeGreaterThan(0n);
    expect(body.visitChargeLabel).toMatch(/^₹/);
  });

  it('FORCES inspect-first for a quote-only service even if the client asks for up-front', async () => {
    const body = await book({
      addressId,
      items: [{ sku: 'PLB-PIP-005', quantity: 1 }], // QUOTE_ONLY, E3-only
      urgencyTier: 'E3',
      inspectFirst: false,
      scheduledSlotStart: '2026-08-10T04:30:00.000Z',
      scheduledSlotEnd: '2026-08-10T06:30:00.000Z',
    });
    expect(body.pricingMode).toBe('INSPECT_FIRST');
    expect(body.estimate).toBeNull();
  });

  it('refuses to start payment on an inspect-first booking', async () => {
    const body = await book({ ...SAME_DAY_FIXED, addressId, inspectFirst: true });
    const res = await http
      .post(`/bookings/${body.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .expect(409);
    expect(res.body.code).toBe('CONFLICT');
    expect(res.body.message).toContain('nothing to pay yet');
  });

  // ── validation ───────────────────────────────────────────────────────────

  it('requires an Idempotency-Key header', async () => {
    const res = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...SAME_DAY_FIXED, addressId })
      .expect(409);
    expect(res.body.details.header).toBe('Idempotency-Key');
  });

  it('rejects a service that cannot be booked at the requested urgency', async () => {
    const res = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ addressId, items: [{ sku: 'PLB-TNK-001' }], urgencyTier: 'E2' }) // E3-only SKU
      .expect(409);
    expect(res.body.message).toContain('cannot be booked');
  });

  it('requires a slot for a scheduled (E3) booking', async () => {
    const res = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ addressId, items: [{ sku: 'PLB-DRN-007' }], urgencyTier: 'E3' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('will not book to an address belonging to someone else', async () => {
    const other = await prisma.address.findFirstOrThrow({ where: { userId: { not: userId } } });
    await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ ...SAME_DAY_FIXED, addressId: other.id })
      .expect(404);
  });

  it('requires a session', async () => {
    await http.post('/bookings').set('Idempotency-Key', nextKey()).send(SAME_DAY_FIXED).expect(401);
  });

  // ── idempotency ──────────────────────────────────────────────────────────

  it('replays the same response for a repeated Idempotency-Key', async () => {
    const key = nextKey();
    const payload = { ...SAME_DAY_FIXED, addressId };
    const first = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);
    createdBookingIds.push(first.body.id);

    const second = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send(payload)
      .expect(201);

    expect(second.body.id).toBe(first.body.id); // ONE booking, not two
    expect(second.body).toEqual(first.body);
    expect(await prisma.booking.count({ where: { id: first.body.id } })).toBe(1);
  });

  it('rejects the same key used with a different body', async () => {
    const key = nextKey();
    const first = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ ...SAME_DAY_FIXED, addressId })
      .expect(201);
    createdBookingIds.push(first.body.id);

    const res = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ ...SAME_DAY_FIXED, addressId, items: [{ sku: 'PLB-DRN-003', quantity: 2 }] })
      .expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('two concurrent identical submissions leave exactly ONE booking row', async () => {
    const key = nextKey();
    const payload = { ...SAME_DAY_FIXED, addressId };
    const before = await prisma.booking.count({ where: { userId } });

    const send = () =>
      http
        .post('/bookings')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send(payload);

    const [a, b] = await Promise.all([send(), send()]);

    // One request wins outright. The other either replays the winner's response
    // or is told to retry (409) — but it must NEVER do the work itself.
    const winners = [a, b].filter((r) => r.status === 201);
    expect(winners.length).toBeGreaterThanOrEqual(1);
    for (const w of winners) expect(w.body.id).toBe(winners[0]?.body.id);
    for (const r of [a, b]) expect([201, 409]).toContain(r.status);

    // The real assertion: exactly one row was created. An earlier
    // run-then-claim implementation silently orphaned a second booking here.
    const after = await prisma.booking.count({ where: { userId } });
    expect(after).toBe(before + 1);

    const id = winners[0]?.body.id as string;
    createdBookingIds.push(id);
  });

  it('a failed request releases its key so the client can retry', async () => {
    const key = nextKey();
    // First attempt fails on an unknown coupon (handler throws after claiming).
    await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ ...SAME_DAY_FIXED, addressId, couponCode: 'DOES-NOT-EXIST' })
      .expect(404);

    // The SAME key must now be usable again — a transient failure must not
    // permanently poison it.
    const retry = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ ...SAME_DAY_FIXED, addressId, couponCode: 'DOES-NOT-EXIST' })
      .expect(404);
    expect(retry.body.code).toBe('NOT_FOUND');
  });

  // ── reads ────────────────────────────────────────────────────────────────

  it('fetches and lists the customer own bookings', async () => {
    const created = await book({ ...SAME_DAY_FIXED, addressId });
    const one = await http
      .get(`/bookings/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(one.body.booking.id).toBe(created.id);

    const list = await http.get('/bookings').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.bookings.some((b: { id: string }) => b.id === created.id)).toBe(true);
  });

  it('404s someone else booking rather than revealing it exists', async () => {
    const otherUser = await prisma.user.findFirstOrThrow({ where: { id: { not: userId } } });
    const otherAddress = await prisma.address.findFirstOrThrow({ where: { userId: otherUser.id } });
    const foreign = await prisma.booking.create({
      data: {
        userId: otherUser.id,
        addressId: otherAddress.id,
        urgencyTier: 'E2',
        estimateTotalPaise: 1000n,
      },
    });
    createdBookingIds.push(foreign.id);

    await http.get(`/bookings/${foreign.id}`).set('Authorization', `Bearer ${token}`).expect(404);
  });

  // ── cancellation ─────────────────────────────────────────────────────────

  it('cancels a booking and records an audit entry with the reason', async () => {
    const created = await book({ ...SAME_DAY_FIXED, addressId });
    const res = await http
      .post(`/bookings/${created.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Fixed it myself' })
      .expect(201);
    expect(res.body.booking.status).toBe('CANCELLED_BY_USER');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: created.id, action: 'booking.cancel' },
    });
    expect(audit.reason).toBe('Fixed it myself');
  });

  it('refuses to cancel an already-cancelled booking (illegal transition)', async () => {
    const created = await book({ ...SAME_DAY_FIXED, addressId });
    await http
      .post(`/bookings/${created.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const res = await http
      .post(`/bookings/${created.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  // ── payment + webhook ────────────────────────────────────────────────────

  it('creates a payment intent for the estimate amount', async () => {
    const created = await book({ ...SAME_DAY_FIXED, addressId });
    const res = await http
      .post(`/bookings/${created.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .expect(201);
    expect(res.body.amountPaise).toBe(created.estimate.totalPaise);
    expect(res.body.gatewayOrderId).toMatch(/^order_stub_/);
    expect(res.body.action).toBe('OPEN_GATEWAY_CHECKOUT');
  });

  it('rejects a webhook with a bad signature', async () => {
    await http
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', 'forged')
      .send({ event: 'payment.captured', payload: {} })
      .expect(401);
  });

  it('ignores unknown webhook event types without erroring', async () => {
    const res = await http
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', 'stub-signature')
      .send({
        event: 'payment.authorized',
        payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } },
      })
      .expect(200);
    expect(res.body).toEqual({ received: true, handled: false });
  });

  /** WO-05 DONE CRITERION: book → pay → webhook → manual assign → ASSIGNED. */
  it('books, pays via webhook, and reaches ASSIGNED with a job and timeline', async () => {
    // 1. book
    const created = await book({ ...SAME_DAY_FIXED, addressId });
    expect(created.status).toBe('PENDING_PAYMENT');

    // 2. start payment
    const intent = await http
      .post(`/bookings/${created.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .expect(201);

    // 3. gateway confirms capture
    await http
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', 'stub-signature')
      .send({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: 'pay_test_1', order_id: intent.body.gatewayOrderId, method: 'upi' },
          },
        },
      })
      .expect(200);

    const confirmed = await http
      .get(`/bookings/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(confirmed.body.booking.status).toBe('CONFIRMED');

    // 4. ops assigns a plumber
    const partner = await prisma.partner.findFirstOrThrow({ where: { phone: PARTNER_PHONE } });
    const assigned = await http
      .post('/ops/assign')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ bookingId: created.id, partnerId: partner.id })
      .expect(201);

    expect(assigned.body.assignment.startOtp).toMatch(/^\d{4}$/);

    const final = await http
      .get(`/bookings/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(final.body.booking.status).toBe('ASSIGNED');

    // a Job exists, with an append-only timeline entry
    const job = await prisma.job.findFirstOrThrow({ where: { bookingId: created.id } });
    expect(job.status).toBe('ASSIGNED');
    expect(job.startOtp).toMatch(/^\d{4}$/);
    expect(job.endOtp).not.toBe(job.startOtp);

    const events = await prisma.jobTimelineEvent.findMany({ where: { jobId: job.id } });
    expect(events.map((e) => e.eventType)).toContain('job.assigned');
  });

  it('a replayed capture webhook does not double-confirm', async () => {
    const created = await book({ ...SAME_DAY_FIXED, addressId });
    const intent = await http
      .post(`/bookings/${created.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .expect(201);

    const capture = () =>
      http
        .post('/webhooks/razorpay')
        .set('x-razorpay-signature', 'stub-signature')
        .send({
          event: 'payment.captured',
          payload: {
            payment: {
              entity: { id: 'pay_test_2', order_id: intent.body.gatewayOrderId, method: 'upi' },
            },
          },
        })
        .expect(200);

    await capture();
    await capture(); // gateways retry — this must be a no-op

    expect(
      await prisma.payment.count({ where: { bookingId: created.id, status: 'CAPTURED' } }),
    ).toBe(1);
    const after = await http
      .get(`/bookings/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(after.body.booking.status).toBe('CONFIRMED');
  });

  it('refuses to assign a partner who already has an active job', async () => {
    const partner = await prisma.partner.findFirstOrThrow({ where: { phone: PARTNER_PHONE } });

    // The previous test left this partner on an active job; a second assign
    // must be refused by the DB-level guard, surfaced as a clean conflict.
    const created = await book({ ...SAME_DAY_FIXED, addressId, inspectFirst: true });
    const res = await http
      .post('/ops/assign')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ bookingId: created.id, partnerId: partner.id })
      .expect(409);
    expect(res.body.message).toContain('already has an active job');
  });
});
