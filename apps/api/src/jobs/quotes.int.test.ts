/**
 * The on-site quote loop, end to end against real Postgres + Redis.
 *
 * This is the test that proves the product's central promise: an inspect-first
 * booking carries NO price until the plumber has looked, the customer sees an
 * itemised quote, and work cannot begin until they approve it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import Redis from 'ioredis';
import { createPrismaClient, type PrismaClient } from '@pipefix/db';
import { TEST_ENV, createTestApp, infraIsUp } from '../test-app';

const up = await infraIsUp();

const CUSTOMER_PHONE = '+919877700011';
const PARTNER_PHONE = '+919877700022';
const DEVICE = 'device-quote-tests';

// The seeded address sits at POINT(77.622 12.934) in Koramangala.
const AT_THE_DOOR = { lat: 12.934, lng: 77.622 };
const FAR_AWAY = { lat: 12.978, lng: 77.641 }; // Indiranagar, ~5 km off

let keySeq = 0;
const nextKey = (): string => `qtest-key-${Date.now()}-${(keySeq += 1)}`;

describe.skipIf(!up)('on-site quotes', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;
  let prisma: PrismaClient;
  let redis: Redis;
  let token: string;
  let partnerToken: string;
  let partnerId: string;
  let addressId: string;
  let userId: string;

  beforeAll(async () => {
    redis = new Redis(TEST_ENV.REDIS_URL);
    prisma = createPrismaClient(TEST_ENV.DATABASE_URL);
    app = await createTestApp();
    http = request(app.getHttpServer());

    const user = await prisma.user.upsert({
      where: { phone: CUSTOMER_PHONE },
      create: { phone: CUSTOMER_PHONE, name: 'Quote Test Customer' },
      update: {},
    });
    userId = user.id;

    const existing = await prisma.address.findFirst({ where: { userId } });
    const address =
      existing ??
      (await prisma.address.create({
        data: {
          userId,
          label: 'Home',
          line1: '42, 6th Block',
          line2: 'Koramangala',
          pincode: '560095',
          city: 'Bengaluru',
          isDefault: true,
        },
      }));
    addressId = address.id;
    await prisma.$executeRaw`UPDATE "Address" SET location = ST_GeogFromText('POINT(77.622 12.934)') WHERE id = ${addressId}`;

    const partner = await prisma.partner.upsert({
      where: { phone: PARTNER_PHONE },
      create: {
        phone: PARTNER_PHONE,
        name: 'Quote Test Plumber',
        status: 'ACTIVE',
        skillTier: 'L3',
      },
      update: { status: 'ACTIVE', skillTier: 'L3', deviceId: null },
    });
    partnerId = partner.id;

    const creq = await http.post('/auth/otp/request').send({ phone: CUSTOMER_PHONE }).expect(200);
    const clogin = await http
      .post('/auth/otp/verify')
      .send({ phone: CUSTOMER_PHONE, code: creq.body.devCode })
      .expect(200);
    token = clogin.body.accessToken;

    const preq = await http
      .post('/partner/auth/otp/request')
      .send({ phone: PARTNER_PHONE })
      .expect(200);
    const plogin = await http
      .post('/partner/auth/otp/verify')
      .send({ phone: PARTNER_PHONE, code: preq.body.devCode, deviceId: DEVICE })
      .expect(200);
    partnerToken = plogin.body.accessToken;
  });

  afterAll(async () => {
    const bookingIds = (
      await prisma.booking.findMany({ where: { userId }, select: { id: true } })
    ).map((b) => b.id);
    const jobIds = (
      await prisma.job.findMany({ where: { bookingId: { in: bookingIds } }, select: { id: true } })
    ).map((j) => j.id);

    await prisma.quoteApproval.deleteMany({ where: { quote: { jobId: { in: jobIds } } } });
    await prisma.quoteLine.deleteMany({ where: { quote: { jobId: { in: jobIds } } } });
    await prisma.quote.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.materialLine.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobPhoto.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobTimelineEvent.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.bookingItem.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.idempotencyRecord.deleteMany({ where: { key: { contains: 'qtest-key-' } } });
    await prisma.partner.deleteMany({ where: { phone: PARTNER_PHONE } });
    await prisma.address.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    redis.disconnect();
    await app.close();
  });

  /** Book inspect-first, assign our partner, and walk to DIAGNOSING. */
  async function jobReadyToQuote(
    sku = 'PLB-LEAK-004',
  ): Promise<{ jobId: string; bookingId: string; startOtp: string }> {
    // Free the partner from any previous job so the active-job index allows this.
    await prisma.job.updateMany({
      where: { partnerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'COMPLETED' },
    });

    const booking = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({
        addressId,
        items: [{ sku }],
        urgencyTier: 'E3',
        inspectFirst: true,
        scheduledSlotStart: '2026-08-20T04:30:00.000Z',
        scheduledSlotEnd: '2026-08-20T06:30:00.000Z',
      })
      .expect(201);

    const assign = await http
      .post('/ops/assign')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ bookingId: booking.body.id, partnerId })
      .expect(201);

    const jobId = assign.body.assignment.jobId as string;
    const startOtp = assign.body.assignment.startOtp as string;

    await http
      .post(`/partner/jobs/${jobId}/start`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/arrive`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ otp: startOtp, ...AT_THE_DOOR })
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/diagnose`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    return { jobId, bookingId: booking.body.id, startOtp };
  }

  const LINES = [
    {
      description: 'Concealed pipe repair (slab section)',
      kind: 'LABOUR' as const,
      unitPricePaise: '185000',
    },
    { description: 'CPVC pipe 20mm x 2m', kind: 'MATERIAL' as const, unitPricePaise: '24000' },
  ];

  // ── arrival guards ───────────────────────────────────────────────────────

  it('refuses check-in from outside the 100 m geofence', async () => {
    await prisma.job.updateMany({
      where: { partnerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'COMPLETED' },
    });
    const booking = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ addressId, items: [{ sku: 'PLB-DRN-001' }], urgencyTier: 'E2', inspectFirst: true })
      .expect(201);
    const assign = await http
      .post('/ops/assign')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ bookingId: booking.body.id, partnerId })
      .expect(201);
    const { jobId, startOtp } = {
      jobId: assign.body.assignment.jobId,
      startOtp: assign.body.assignment.startOtp,
    };

    await http
      .post(`/partner/jobs/${jobId}/start`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const res = await http
      .post(`/partner/jobs/${jobId}/arrive`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ otp: startOtp, ...FAR_AWAY })
      .expect(409);
    expect(res.body.message).toContain('need to be at the');
    expect(res.body.details.limitM).toBe(100);
  });

  it('refuses check-in with the wrong start code even at the door', async () => {
    await prisma.job.updateMany({
      where: { partnerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'COMPLETED' },
    });
    const booking = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ addressId, items: [{ sku: 'PLB-DRN-001' }], urgencyTier: 'E2', inspectFirst: true })
      .expect(201);
    const assign = await http
      .post('/ops/assign')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ bookingId: booking.body.id, partnerId })
      .expect(201);
    const jobId = assign.body.assignment.jobId;

    await http
      .post(`/partner/jobs/${jobId}/start`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/arrive`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ otp: '0000', ...AT_THE_DOOR })
      .expect(403);
  });

  // ── raising a quote ──────────────────────────────────────────────────────

  it('a partner cannot quote before diagnosing', async () => {
    await prisma.job.updateMany({
      where: { partnerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'COMPLETED' },
    });
    const booking = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ addressId, items: [{ sku: 'PLB-DRN-001' }], urgencyTier: 'E2', inspectFirst: true })
      .expect(201);
    const assign = await http
      .post('/ops/assign')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ bookingId: booking.body.id, partnerId })
      .expect(201);

    const res = await http
      .post(`/partner/jobs/${assign.body.assignment.jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'too early' })
      .expect(409);
    expect(res.body.message).toContain('Diagnose the problem');
  });

  it('raises an itemised quote with a full labelled breakdown', async () => {
    const { jobId } = await jobReadyToQuote();
    const res = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: LINES,
        reason: 'Slab leak traced to a cracked joint under the bathroom floor.',
      })
      .expect(201);

    const quote = res.body.quote;
    // ₹1850 labour + ₹240 material = ₹2090, +18% GST = ₹2466.20
    expect(quote.totalLabel).toBe('₹2,466.20');
    expect(quote.lines).toHaveLength(2);
    expect(quote.reason).toContain('Slab leak');
    for (const line of quote.breakdown) {
      expect(line.label.length).toBeGreaterThan(0);
      expect(line.amountLabel).toMatch(/^-?₹/);
    }
    expect(quote.declineChargeLabel).toMatch(/^₹/);
  });

  it('requires a bill photo for material lines over ₹500', async () => {
    const { jobId } = await jobReadyToQuote();
    const res = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: [
          { description: 'Labour', kind: 'LABOUR', unitPricePaise: '50000' },
          { description: 'Expensive brass fittings', kind: 'MATERIAL', unitPricePaise: '120000' },
        ],
        reason: 'Needs new fittings',
      })
      .expect(409);
    expect(res.body.message).toContain('photo of the bill');
  });

  it('accepts a large material line when the bill photo is attached', async () => {
    const { jobId } = await jobReadyToQuote();
    await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: [
          { description: 'Labour', kind: 'LABOUR', unitPricePaise: '50000' },
          {
            description: 'Expensive brass fittings',
            kind: 'MATERIAL',
            unitPricePaise: '120000',
            billPhotoKey: 'photos/bill-123.jpg',
          },
        ],
        reason: 'Needs new fittings',
      })
      .expect(201);

    const materials = await prisma.materialLine.findMany({ where: { jobId } });
    expect(materials[0]?.billPhotoKey).toBe('photos/bill-123.jpg');
  });

  it('rejects a quote with no labour line', async () => {
    const { jobId } = await jobReadyToQuote();
    await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: [{ description: 'Just parts', kind: 'MATERIAL', unitPricePaise: '10000' }],
        reason: 'parts only',
      })
      .expect(409);
  });

  it('rejects an absurd total that looks like a paise/rupee mix-up', async () => {
    const { jobId } = await jobReadyToQuote();
    const res = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: [{ description: 'Oops', kind: 'LABOUR', unitPricePaise: '99000000' }],
        reason: 'fat finger',
      })
      .expect(409);
    expect(res.body.message).toContain('above the limit');
  });

  it('a partner cannot quote on a job that is not theirs', async () => {
    const { jobId } = await jobReadyToQuote();
    const otherPartner = await prisma.partner.findFirstOrThrow({
      where: { phone: '+919800000002' }, // seeded Suresh Gowda
    });
    const oreq = await http
      .post('/partner/auth/otp/request')
      .send({ phone: otherPartner.phone })
      .expect(200);
    const ologin = await http
      .post('/partner/auth/otp/verify')
      .send({ phone: otherPartner.phone, code: oreq.body.devCode, deviceId: 'someone-else' })
      .expect(200);

    await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${ologin.body.accessToken}`)
      .send({ lines: LINES, reason: 'not mine' })
      .expect(403);
  });

  // ── the >30% guardrail ───────────────────────────────────────────────────

  it('flags a quote far above an up-front estimate and records ADMIN_REVIEW_FLAG', async () => {
    await prisma.job.updateMany({
      where: { partnerId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'COMPLETED' },
    });
    // An UPFRONT booking has a real estimate to compare against — and it must
    // actually be PAID before it can be assigned (the state machine enforces
    // that, which is why this test pays first rather than assigning directly).
    const booking = await http
      .post('/bookings')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .send({ addressId, items: [{ sku: 'PLB-DRN-001' }], urgencyTier: 'E2' })
      .expect(201);

    const intent = await http
      .post(`/bookings/${booking.body.id}/pay`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', nextKey())
      .expect(201);
    await http
      .post('/webhooks/razorpay')
      .set('x-razorpay-signature', 'stub-signature')
      .send({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: `pay_q_${Date.now()}`,
              order_id: intent.body.gatewayOrderId,
              method: 'upi',
            },
          },
        },
      })
      .expect(200);

    const assign = await http
      .post('/ops/assign')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ bookingId: booking.body.id, partnerId })
      .expect(201);
    const jobId = assign.body.assignment.jobId;

    await http
      .post(`/partner/jobs/${jobId}/start`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/arrive`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ otp: assign.body.assignment.startOtp, ...AT_THE_DOOR })
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/diagnose`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    // Estimate was ₹411.82; quote ₹2,000+ is far more than 30% above.
    const res = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: [
          {
            description: 'Turned out to be a full re-pipe',
            kind: 'LABOUR',
            unitPricePaise: '200000',
          },
        ],
        reason: 'The blockage was a collapsed pipe, not a clog.',
      })
      .expect(201);

    expect(res.body.quote.flaggedForReview).toBe(true);
    const flag = await prisma.jobTimelineEvent.findFirst({
      where: { jobId, eventType: 'ADMIN_REVIEW_FLAG' },
    });
    expect(flag).not.toBeNull();
  });

  // ── customer decision ────────────────────────────────────────────────────

  it('work cannot start while the quote is unapproved', async () => {
    const { jobId } = await jobReadyToQuote();
    await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'Needs a repair' })
      .expect(201);

    const res = await http
      .post(`/partner/jobs/${jobId}/begin-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(409);
    expect(res.body.message).toContain('not approved the quote');
  });

  it('the customer sees the quote, approves it, and only then can work begin', async () => {
    const { jobId, bookingId } = await jobReadyToQuote();
    const raised = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'Slab leak repair' })
      .expect(201);
    const quoteId = raised.body.quote.quoteId;

    // customer sees it
    const seen = await http
      .get(`/bookings/${bookingId}/quotes`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(seen.body.quotes[0].quoteId).toBe(quoteId);
    expect(seen.body.quotes[0].totalLabel).toBe('₹2,466.20');

    // approves
    const approved = await http
      .post(`/bookings/${bookingId}/quotes/${quoteId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');

    // the approved amount becomes the booking's real total
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.finalTotalPaise).toBe(246620n);

    // NOW work may start
    await http
      .post(`/partner/jobs/${jobId}/begin-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const approval = await prisma.quoteApproval.findUniqueOrThrow({ where: { quoteId } });
    expect(approval.method).toBe('IN_APP');
  });

  it('declining charges only the visit charge and winds the job down', async () => {
    const { jobId, bookingId } = await jobReadyToQuote();
    const raised = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'Slab leak repair' })
      .expect(201);

    const declined = await http
      .post(`/bookings/${bookingId}/quotes/${raised.body.quote.quoteId}/decline`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Too expensive for now' })
      .expect(200);
    expect(declined.body.status).toBe('DECLINED');
    expect(declined.body.visitChargeLabel).toMatch(/^₹/);

    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.status).toBe('VISIT_CHARGE_ONLY');
    // The customer owes the visit charge, NOT the quoted amount.
    expect(booking.finalTotalPaise).not.toBe(246620n);
  });

  it('another customer cannot approve someone else quote', async () => {
    const { jobId, bookingId } = await jobReadyToQuote();
    const raised = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'Slab leak repair' })
      .expect(201);

    const areq = await http.post('/auth/otp/request').send({ phone: '+919812345002' }).expect(200);
    const alogin = await http
      .post('/auth/otp/verify')
      .send({ phone: '+919812345002', code: areq.body.devCode })
      .expect(200);

    await http
      .post(`/bookings/${bookingId}/quotes/${raised.body.quote.quoteId}/approve`)
      .set('Authorization', `Bearer ${alogin.body.accessToken}`)
      .expect(404);
  });

  it('a revised quote supersedes the previous one', async () => {
    const { jobId, bookingId } = await jobReadyToQuote();
    const first = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'First look' })
      .expect(201);

    const second = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: [
          { description: 'Simpler fix than expected', kind: 'LABOUR', unitPricePaise: '60000' },
        ],
        reason: 'Found an easier route — cheaper.',
      })
      .expect(201);

    expect(second.body.quote.quoteId).not.toBe(first.body.quote.quoteId);
    const superseded = await prisma.quote.findUniqueOrThrow({
      where: { id: first.body.quote.quoteId },
    });
    expect(superseded.status).toBe('REVISED');

    // The customer can only act on the live one.
    await http
      .post(`/bookings/${bookingId}/quotes/${first.body.quote.quoteId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    await http
      .post(`/bookings/${bookingId}/quotes/${second.body.quote.quoteId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });

  // ── the sewer PPE hard block, through the real API ────────────────────────

  it('BLOCKS sewer work without PPE photo proof, then allows it once uploaded', async () => {
    // PLB-DRN-009 is manhole/chamber cleaning — confined-space work.
    const { jobId, bookingId } = await jobReadyToQuote('PLB-DRN-009');
    const raised = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        lines: [
          { description: 'Machine jetting of chamber', kind: 'LABOUR', unitPricePaise: '149900' },
        ],
        reason: 'Chamber fully blocked, needs jetting.',
      })
      .expect(201);
    await http
      .post(`/bookings/${bookingId}/quotes/${raised.body.quote.quoteId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Approved quote, but no PPE proof — must be refused.
    const blocked = await http
      .post(`/partner/jobs/${jobId}/begin-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(403);
    expect(blocked.body.message).toContain('legal requirement');
    expect(blocked.body.details.reason).toBe('ppe_proof_required');

    // Upload the PPE photo…
    await http
      .post(`/partner/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ phase: 'BEFORE', fileKey: 'photos/ppe-proof.jpg', isPpeProof: true })
      .expect(201);

    // …and now it is allowed.
    await http
      .post(`/partner/jobs/${jobId}/begin-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
  });

  // ── completion guards ────────────────────────────────────────────────────

  it('requires an after-photo above ₹1,000 before work can be marked done', async () => {
    const { jobId, bookingId } = await jobReadyToQuote();
    const raised = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'Slab leak repair' })
      .expect(201);
    await http
      .post(`/bookings/${bookingId}/quotes/${raised.body.quote.quoteId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/begin-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    const blocked = await http
      .post(`/partner/jobs/${jobId}/finish-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(409);
    expect(blocked.body.details.reason).toBe('after_photo_required');

    await http
      .post(`/partner/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ phase: 'AFTER', fileKey: 'photos/after.jpg' })
      .expect(201);

    await http
      .post(`/partner/jobs/${jobId}/finish-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
  });

  it('refuses to close the job with a wrong end code', async () => {
    const { jobId, bookingId } = await jobReadyToQuote();
    const raised = await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'Slab leak repair' })
      .expect(201);
    await http
      .post(`/bookings/${bookingId}/quotes/${raised.body.quote.quoteId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/begin-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    await http
      .post(`/partner/jobs/${jobId}/photos`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ phase: 'AFTER', fileKey: 'photos/after.jpg' })
      .expect(201);
    await http
      .post(`/partner/jobs/${jobId}/finish-work`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);

    await http
      .post(`/partner/jobs/${jobId}/complete`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ otp: '0000' })
      .expect(403);
  });

  it('lists the partner jobs with the right next action and no price for inspect-first', async () => {
    const { jobId } = await jobReadyToQuote();
    const res = await http
      .get('/partner/jobs')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(200);
    const job = res.body.jobs.find((j: { jobId: string }) => j.jobId === jobId);
    expect(job.estimateLabel).toBeNull(); // inspect-first: no price to show the partner either
    expect(job.nextAction).toContain('itemised quote');
    expect(job.customerName).toBe('Quote Test Customer');
  });

  it('records every step on the append-only timeline', async () => {
    const { jobId } = await jobReadyToQuote();
    await http
      .post(`/partner/jobs/${jobId}/quote`)
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ lines: LINES, reason: 'Slab leak repair' })
      .expect(201);

    const events = await prisma.jobTimelineEvent.findMany({
      where: { jobId },
      orderBy: { occurredAt: 'asc' },
    });
    const types = events.map((e) => e.eventType);
    expect(types).toEqual(
      expect.arrayContaining([
        'job.assigned',
        'job.started',
        'job.arrived',
        'job.diagnosing',
        'quote.raised',
      ]),
    );
  });
});
