/**
 * Emergency tier integration tests — the product's differentiator, so these are
 * the ones to read if you only read one file.
 *
 * Covers: SOS intake speed-path ordering, the safety-script hard block, the
 * gas-smell no-dispatch path, surge freezing, AMC Plus benefits, and the
 * automatic money-back guarantee.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { createPrismaClient, type PrismaClient } from '@pipefix/db';
import { TEST_ENV, createTestApp, infraIsUp } from '../test-app';
import { SafetyScriptsService } from './safety-scripts.service';
import { SlaWatchdogService } from './sla-watchdog.service';
import { SurgeService } from './surge.service';

const up = await infraIsUp();

const CUSTOMER_PHONE = '+919866600011';
const AMC_PHONE = '+919866600033';

let keySeq = 0;
const nextKey = (): string => `etest-key-${Date.now()}-${(keySeq += 1)}`;

describe.skipIf(!up)('emergency tier', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaClient;
  let redis: Redis;
  let token: string;
  let amcToken: string;
  let userId: string;
  let amcUserId: string;
  let addressId: string;
  let amcAddressId: string;

  async function makeCustomer(phone: string, name: string, pincode: string) {
    const user = await prisma.user.upsert({
      where: { phone },
      create: { phone, name },
      update: {},
    });
    const existing = await prisma.address.findFirst({ where: { userId: user.id } });
    const address =
      existing ??
      (await prisma.address.create({
        data: {
          userId: user.id,
          label: 'Home',
          line1: '11, 4th Cross',
          line2: 'Koramangala',
          pincode,
          city: 'Bengaluru',
          isDefault: true,
        },
      }));
    await prisma.$executeRaw`UPDATE "Address" SET location = ST_GeogFromText('POINT(77.622 12.934)') WHERE id = ${address.id}`;

    const req = await http.post('/auth/otp/request').send({ phone }).expect(200);
    const login = await http
      .post('/auth/otp/verify')
      .send({ phone, code: req.body.devCode })
      .expect(200);
    return { userId: user.id, addressId: address.id, token: login.body.accessToken as string };
  }

  beforeAll(async () => {
    redis = new Redis(TEST_ENV.REDIS_URL);
    prisma = createPrismaClient(TEST_ENV.DATABASE_URL);
    app = await createTestApp();
    http = request(app.getHttpServer());

    const plain = await makeCustomer(CUSTOMER_PHONE, 'Emergency Test Customer', '560095');
    userId = plain.userId;
    addressId = plain.addressId;
    token = plain.token;

    const amc = await makeCustomer(AMC_PHONE, 'AMC Plus Member', '560034');
    amcUserId = amc.userId;
    amcAddressId = amc.addressId;
    amcToken = amc.token;

    // Give the second customer a live AMC Plus subscription.
    const plusPlan = await prisma.aMCPlan.findUniqueOrThrow({ where: { code: 'AMC_PLUS' } });
    const existingSub = await prisma.aMCSubscription.findFirst({ where: { userId: amcUserId } });
    if (existingSub === null) {
      await prisma.aMCSubscription.create({
        data: {
          planId: plusPlan.id,
          userId: amcUserId,
          startsAt: new Date('2026-01-01T00:00:00Z'),
          endsAt: new Date('2027-01-01T00:00:00Z'),
          status: 'ACTIVE',
        },
      });
    }
  });

  afterAll(async () => {
    for (const uid of [userId, amcUserId]) {
      const bookingIds = (
        await prisma.booking.findMany({ where: { userId: uid }, select: { id: true } })
      ).map((b) => b.id);
      await prisma.sLABreachEvent.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.refund.deleteMany({ where: { payment: { bookingId: { in: bookingIds } } } });
      await prisma.walletLedger.deleteMany({ where: { userId: uid } });
      await prisma.emergencyRequest.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.bookingItem.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await prisma.aMCSubscription.deleteMany({ where: { userId: uid } });
      await prisma.address.deleteMany({ where: { userId: uid } });
      await prisma.user.deleteMany({ where: { id: uid } });
    }
    await prisma.idempotencyRecord.deleteMany({ where: { key: { contains: 'etest-key-' } } });
    await prisma.surgeWindow.deleteMany({ where: { h3Index: { in: ['560095', '560034'] } } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await prisma.surgeWindow.deleteMany({ where: { h3Index: { in: ['560095', '560034'] } } });
  });

  async function sos(payload: Record<string, unknown>, asToken = token) {
    return http
      .post('/emergency')
      .set('Authorization', `Bearer ${asToken}`)
      .set('Idempotency-Key', nextKey())
      .send(payload)
      .expect(201);
  }

  // ── intake ───────────────────────────────────────────────────────────────

  it('takes a burst-pipe SOS as E0 with a 30-minute SLA', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    expect(res.body.urgencyTier).toBe('E0');
    expect(res.body.slaMinutes).toBe(30);
    expect(res.body.emergencyFeeLabel).toBe('₹499.00');
    expect(res.body.bookingId).toBeTypeOf('string');
    expect(new Date(res.body.slaTargetAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('returns the safety card WITH the intake response, not after dispatch', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    // The card must be in the very first response — the customer's reading time
    // cannot be allowed to cost them ETA.
    expect(res.body.safetyCard.bodyMarkdown.length).toBeGreaterThan(50);
    expect(res.body.safetyCard.title).toContain('Burst pipe');
    expect(res.body.whatHappensNext).toContain('30 minutes');
  });

  it('routes "no water" to the E1 tier with the lower fee', async () => {
    const res = await sos({ issueType: 'NO_WATER', addressId });
    expect(res.body.urgencyTier).toBe('E1');
    expect(res.body.slaMinutes).toBe(120);
    expect(res.body.emergencyFeeLabel).toBe('₹299.00');
  });

  it('records the emergency request with its SLA target and media', async () => {
    const res = await sos({
      issueType: 'SEWAGE_BACKFLOW',
      addressId,
      mediaKeys: ['media/clip1.mp4'],
    });
    const req = await prisma.emergencyRequest.findUniqueOrThrow({
      where: { id: res.body.emergencyRequestId },
    });
    expect(req.issueType).toBe('SEWAGE_BACKFLOW');
    expect(req.mediaKeys).toEqual(['media/clip1.mp4']);
    expect(req.breached).toBe(false);
    expect(req.assignedAt).toBeNull();
  });

  it('is idempotent — a double-tap on the SOS button creates ONE emergency', async () => {
    const key = nextKey();
    const payload = { issueType: 'BURST_PIPE', addressId };
    const send = () =>
      http
        .post('/emergency')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send(payload);

    const before = await prisma.emergencyRequest.count({ where: { booking: { userId } } });
    const [a, b] = await Promise.all([send(), send()]);
    const after = await prisma.emergencyRequest.count({ where: { booking: { userId } } });

    expect(after).toBe(before + 1);
    const created = [a, b].filter((r) => r.status === 201);
    for (const r of created) expect(r.body.bookingId).toBe(created[0]?.body.bookingId);
  });

  it('rejects an address belonging to someone else', async () => {
    await http
      .post('/emergency')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ issueType: 'BURST_PIPE', addressId: amcAddressId })
      .expect(404);
  });

  it('rejects an unknown issue type at the boundary', async () => {
    const res = await http
      .post('/emergency')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ issueType: 'ALIEN_INVASION', addressId })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  // ── the gas-smell refusal ────────────────────────────────────────────────

  it('REFUSES to dispatch a plumber for a suspected gas leak', async () => {
    const res = await sos({ issueType: 'GAS_SMELL', addressId });
    expect(res.body.bookingId).toBeNull();
    expect(res.body.doNotDispatch).not.toBeNull();
    expect(res.body.doNotDispatch.helpline).toBe('1906');
    expect(res.body.safetyCard.bodyMarkdown).toContain('leave the property');
    expect(res.body.whatHappensNext).toContain('1906');
    // And no booking was created at all.
    expect(await prisma.emergencyRequest.count({ where: { issueType: 'GAS_SMELL' } })).toBe(0);
  });

  // ── the safety-script hard block ─────────────────────────────────────────

  it('serves the seeded draft outside production, clearly marked unreviewed', async () => {
    const res = await http.get('/emergency/safety/BURST_PIPE').expect(200);
    expect(res.body.card.isExpertReviewed).toBe(false);
    expect(res.body.card.pendingExpertReview).toBe(true);
    expect(res.body.card.version).toBeGreaterThan(0);
  });

  it('falls back to conservative advice for an issue with no script at all', async () => {
    const res = await http.get('/emergency/safety/UNKNOWN_THING').expect(200);
    expect(res.body.card.version).toBe(0);
    expect(res.body.card.isExpertReviewed).toBe(false);
    expect(res.body.card.bodyMarkdown).toContain('main stopcock');
    // The fallback must not invent specific plumbing instructions.
    expect(res.body.card.bodyMarkdown).toContain('emergency services');
  });

  it('reports which issue types still lack expert-reviewed copy', async () => {
    const { SafetyScriptsService } = await import('./safety-scripts.service');
    const service = app.get(SafetyScriptsService);
    const pending = await service.unreviewedIssueTypes();
    // All five seeded scripts are drafts — this list is a launch blocker.
    expect(pending).toContain('BURST_PIPE');
    expect(pending).toContain('GEYSER_LEAK');
  });

  it('withholds an unreviewed script when NODE_ENV is production', async () => {
    // Construct the service directly with a production env rather than booting a
    // whole production app — the app deliberately REFUSES to start in production
    // without a real payment gateway, which is its own separate guarantee
    // (see the test below).
    const silentLogger = { warn: () => {}, error: () => {}, info: () => {} };
    const service = new SafetyScriptsService(
      prisma,
      { ...TEST_ENV, NODE_ENV: 'production' },
      silentLogger as unknown as ConstructorParameters<typeof SafetyScriptsService>[2],
    );

    const card = await service.cardFor('BURST_PIPE');
    // The draft exists in the database, but production must NOT serve it.
    expect(card.version).toBe(0);
    expect(card.isExpertReviewed).toBe(false);
    expect(card.bodyMarkdown).toContain('main stopcock'); // the conservative fallback
    expect(card.bodyMarkdown).not.toContain('PENDING_EXPERT_REVIEW');

    // Sanity: outside production the SAME script IS served, so the difference
    // above is genuinely the environment gate and not a missing row.
    const devCard = await app.get(SafetyScriptsService).cardFor('BURST_PIPE');
    expect(devCard.version).toBeGreaterThan(0);
  });

  it('refuses to provide a payment gateway in production until one is wired', async () => {
    const { createPaymentGateway } = await import('../payments/payments.service');
    // A stub must never be selected in production by accident — quietly
    // "accepting" real payments would be far worse than refusing to start.
    expect(() => createPaymentGateway({ NODE_ENV: 'production' })).toThrow(
      /production payment gateway/i,
    );
    expect(createPaymentGateway({ NODE_ENV: 'development' }).name).toBe('stub');
  });

  // ── surge ────────────────────────────────────────────────────────────────

  it('has no surge when supply is keeping up', async () => {
    const surge = app.get(SurgeService);
    const snapshot = await surge.recompute('560095', 1, 10, new Date());
    expect(snapshot.multiplierX100).toBe(100);
    expect(snapshot.reason).toContain('No surge');
  });

  it('raises surge when demand outstrips supply, and caps it at 2.0x', async () => {
    const surge = app.get(SurgeService);
    const now = new Date();
    // Repeated recomputes let the smoothing converge upward.
    let last = 100;
    for (let i = 0; i < 12; i += 1) {
      last = (await surge.recompute('560095', 40, 2, now)).multiplierX100;
    }
    expect(last).toBeGreaterThan(100);
    expect(last).toBeLessThanOrEqual(200);
  });

  it('freezes the surge multiplier onto the booking', async () => {
    const surge = app.get(SurgeService);
    const now = new Date();
    for (let i = 0; i < 12; i += 1) await surge.recompute('560095', 40, 2, now);
    const frozen = await surge.currentMultiplierX100('560095', now);
    expect(frozen).toBeGreaterThan(100);

    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    expect(res.body.surgeMultiplierX100).toBe(frozen);

    // Demand collapses; the booking keeps the multiplier it was quoted.
    await surge.recompute('560095', 0, 20, now);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: res.body.bookingId } });
    expect(booking.surgeMultiplierX100).toBe(frozen);
  });

  // ── AMC Plus benefits ────────────────────────────────────────────────────

  it('gives an AMC Plus member a zero emergency fee', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId: amcAddressId }, amcToken);
    expect(res.body.emergencyFeeLabel).toBe('₹0.00');
  });

  it('caps an AMC Plus member surge at 1.25x', async () => {
    const surge = app.get(SurgeService);
    const now = new Date();
    for (let i = 0; i < 12; i += 1) await surge.recompute('560034', 40, 2, now);
    const zoneSurge = await surge.currentMultiplierX100('560034', now);
    expect(zoneSurge).toBeGreaterThan(125);

    const res = await sos({ issueType: 'BURST_PIPE', addressId: amcAddressId }, amcToken);
    expect(res.body.surgeMultiplierX100).toBeLessThanOrEqual(125);
  });

  // ── the money-back guarantee ─────────────────────────────────────────────

  it('auto-refunds and credits ₹200 when nobody is assigned within 10 minutes', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    const bookingId = res.body.bookingId as string;

    // Simulate a captured pre-auth so there is real money to give back.
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    await prisma.payment.create({
      data: {
        bookingId,
        gateway: 'stub',
        gatewayOrderId: `order_sla_${Date.now()}`,
        amountPaise: booking.emergencyFeePaise,
        status: 'CAPTURED',
        capturedAt: new Date(),
      },
    });

    // Backdate the request past the 10-minute dispatch guarantee.
    await prisma.emergencyRequest.update({
      where: { id: res.body.emergencyRequestId },
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });

    const watchdog = app.get(SlaWatchdogService);
    const outcomes = await watchdog.sweep(new Date());
    const mine = outcomes.find((o) => o.bookingId === bookingId);

    expect(mine).toBeDefined();
    expect(mine?.breachType).toBe('DISPATCH_SLA_BREACH');
    expect(mine?.creditedPaise).toBe('20000'); // ₹200
    expect(mine?.refundedPaise).toBe(booking.emergencyFeePaise.toString());
    expect(mine?.pageOnCall).toBe(true);

    // A refund row, a wallet credit and a breach event all exist.
    const refunds = await prisma.refund.findMany({ where: { payment: { bookingId } } });
    expect(refunds[0]?.reasonCode).toBe('DISPATCH_SLA_BREACH');
    const credit = await prisma.walletLedger.findFirst({
      where: { userId, reasonCode: 'SLA_BREACH_CREDIT', refId: bookingId },
    });
    expect(credit?.amountPaise).toBe(20000n);
    expect(credit?.direction).toBe('CREDIT');
    const event = await prisma.sLABreachEvent.findFirst({ where: { bookingId } });
    expect(event?.breachType).toBe('DISPATCH_SLA_BREACH');
  });

  it('remedies each breach exactly once, however often the watchdog runs', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    await prisma.emergencyRequest.update({
      where: { id: res.body.emergencyRequestId },
      data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
    });

    const watchdog = app.get(SlaWatchdogService);
    await watchdog.sweep(new Date());
    await watchdog.sweep(new Date());
    await watchdog.sweep(new Date());

    const events = await prisma.sLABreachEvent.findMany({
      where: { bookingId: res.body.bookingId },
    });
    expect(events).toHaveLength(1);
    const credits = await prisma.walletLedger.findMany({
      where: { refId: res.body.bookingId, reasonCode: 'SLA_BREACH_CREDIT' },
    });
    expect(credits).toHaveLength(1);
  });

  it('does not refund money that was never captured', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    await prisma.emergencyRequest.update({
      where: { id: res.body.emergencyRequestId },
      data: { createdAt: new Date(Date.now() - 11 * 60 * 1000) },
    });

    const watchdog = app.get(SlaWatchdogService);
    const outcomes = await watchdog.sweep(new Date());
    const mine = outcomes.find((o) => o.bookingId === res.body.bookingId);

    expect(mine?.refundedPaise).toBe('0'); // nothing was taken, nothing to give back
    expect(mine?.creditedPaise).toBe('20000'); // goodwill credit still applies
  });

  it('flags an ARRIVAL breach separately from a dispatch breach', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    // Assigned in time, but the SLA deadline passed without an arrival.
    await prisma.emergencyRequest.update({
      where: { id: res.body.emergencyRequestId },
      data: {
        assignedAt: new Date(Date.now() - 40 * 60 * 1000),
        slaTargetAt: new Date(Date.now() - 5 * 60 * 1000),
      },
    });

    const watchdog = app.get(SlaWatchdogService);
    const outcomes = await watchdog.sweep(new Date());
    const mine = outcomes.find((o) => o.bookingId === res.body.bookingId);

    expect(mine?.breachType).toBe('ARRIVAL_SLA_BREACH');
    expect(mine?.pageOnCall).toBe(false); // supply existed; this is not a page-now
  });

  it('leaves a request alone when the plumber arrived in time', async () => {
    const res = await sos({ issueType: 'BURST_PIPE', addressId });
    await prisma.emergencyRequest.update({
      where: { id: res.body.emergencyRequestId },
      data: {
        assignedAt: new Date(Date.now() - 20 * 60 * 1000),
        arrivedAt: new Date(Date.now() - 5 * 60 * 1000),
        slaTargetAt: new Date(Date.now() - 60 * 1000),
      },
    });

    const watchdog = app.get(SlaWatchdogService);
    const outcomes = await watchdog.sweep(new Date());
    expect(outcomes.find((o) => o.bookingId === res.body.bookingId)).toBeUndefined();
  });

  it('requires a session for SOS', async () => {
    await http
      .post('/emergency')
      .set('Idempotency-Key', nextKey())
      .send({ issueType: 'BURST_PIPE', addressId })
      .expect(401);
  });
});
