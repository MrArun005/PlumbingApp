/**
 * Integration test against the real docker-compose Postgres (+PostGIS).
 * Skips itself cleanly when the database is not reachable (e.g. CI without
 * infra), so `pnpm test` never fails on a laptop without Docker running.
 *
 * Assumes `pnpm db:migrate && pnpm db:seed` have run (RUNBOOK first-time setup).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const url =
  process.env.DATABASE_URL ??
  'postgresql://pipefix:pipefix_dev_pw@localhost:5432/pipefix?schema=public';

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function dbIsUp(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const up = await dbIsUp();

describe.skipIf(!up)('seeded database', () => {
  afterAll(() => prisma.$disconnect());

  it('has the full catalog', async () => {
    expect(await prisma.serviceCategory.count()).toBe(10);
    expect(await prisma.service.count()).toBe(74);
  });

  it('burst-pipe SKU is E0-eligible with the anchor price', async () => {
    const sku = await prisma.service.findUniqueOrThrow({ where: { sku: 'PLB-LEAK-007' } });
    expect(sku.urgencyEligible).toContain('E0');
    expect(sku.basePricePaise).toBe(89900n);
    expect(sku.skillTier).toBe('L3');
  });

  it('sewer SKUs require machine tools + PPE (manual entry is illegal)', async () => {
    const sewage = await prisma.service.findUniqueOrThrow({ where: { sku: 'PLB-DRN-008' } });
    expect(sewage.requiredTools).toEqual(expect.arrayContaining(['JETTING_UNIT', 'PPE_KIT']));
  });

  it('zones have PostGIS polygons and contain the seeded addresses', async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT z.name
      FROM "ZoneGeofence" z
      JOIN "Address" a ON a.location IS NOT NULL AND ST_Covers(z.polygon, a.location)
      ORDER BY z.name`;
    expect(rows.map((r) => r.name)).toEqual(['Indiranagar', 'Koramangala–HSR']);
  });

  it('has 10 active partners with skills and weekday availability', async () => {
    expect(await prisma.partner.count({ where: { status: 'ACTIVE' } })).toBe(10);
    expect(await prisma.partnerSkill.count()).toBeGreaterThanOrEqual(20);
    expect(await prisma.partnerAvailability.count()).toBe(60); // 10 partners × Mon–Sat
  });

  it('price rules are versioned and effective-dated', async () => {
    const night = await prisma.priceRule.findFirstOrThrow({
      where: { type: 'NIGHT', version: 1 },
    });
    expect(night.effectiveFrom).toBeInstanceOf(Date);
    expect((night.params as { multiplierX100: number }).multiplierX100).toBe(150);
  });

  it('safety scripts exist but are NOT expert-reviewed (must never serve)', async () => {
    const scripts = await prisma.safetyScript.findMany();
    expect(scripts.length).toBe(5);
    for (const s of scripts) expect(s.reviewedAt).toBeNull();
  });

  it('money columns round-trip as bigint', async () => {
    const plan = await prisma.aMCPlan.findUniqueOrThrow({ where: { code: 'AMC_PLUS' } });
    expect(typeof plan.pricePaise).toBe('bigint');
    expect(plan.pricePaise).toBe(399900n);
  });
});

describe.skipIf(!up)('DB-level guard: one active job per partner', () => {
  const createdJobIds: string[] = [];
  let bookingId!: string;
  let partnerId!: string;

  beforeAll(async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { phone: '+919812345001' } });
    const address = await prisma.address.findFirstOrThrow({ where: { userId: user.id } });
    const partner = await prisma.partner.findFirstOrThrow({ where: { phone: '+919800000001' } });
    partnerId = partner.id;
    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        addressId: address.id,
        urgencyTier: 'E2',
        status: 'CONFIRMED',
        estimateTotalPaise: 34900n,
      },
    });
    bookingId = booking.id;
  });

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { id: { in: createdJobIds } } });
    await prisma.booking.delete({ where: { id: bookingId } });
    await prisma.$disconnect();
  });

  it('rejects a second ACTIVE job for the same partner at the DB level', async () => {
    const first = await prisma.job.create({
      data: { bookingId, partnerId, status: 'ASSIGNED', startOtp: '1111', endOtp: '2222' },
    });
    createdJobIds.push(first.id);

    await expect(
      prisma.job.create({
        data: { bookingId, partnerId, status: 'EN_ROUTE', startOtp: '3333', endOtp: '4444' },
      }),
    ).rejects.toThrow(/unique/i);

    // …but a COMPLETED job coexists fine (partial index only covers active states)
    const done = await prisma.job.create({
      data: { bookingId, partnerId, status: 'COMPLETED', startOtp: '5555', endOtp: '6666' },
    });
    createdJobIds.push(done.id);
  });
});
