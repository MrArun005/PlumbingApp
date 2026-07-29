import { afterEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@pipefix/shared';
import { allocateProRata, computePrice } from './compute-price';
import type { Money } from '@pipefix/shared';
import type { PriceInput, PriceRuleSet } from './types';

// ── fixtures ────────────────────────────────────────────────────────────────

/** Mirrors the seeded v1 price rules. */
const RULES: PriceRuleSet = {
  night: { multiplierX100: 150, startHourIst: 22, endHourIst: 6 },
  holiday: { multiplierX100: 125, sundays: true, holidayDatesIst: ['2026-08-15'] },
  emergencyFee: {
    e0Paise: 49900n,
    e1Paise: 29900n,
    e1WaiverSubtotalOverPaise: 150000n,
    gstRatePct: 18,
  },
  surge: { capX100: 200 },
};

// IST = UTC+05:30. 2026-07-29 is a Wednesday; 2026-08-02 is a Sunday.
const WEDNESDAY_2PM_IST = new Date('2026-07-29T08:30:00Z'); // 14:00 IST
const WEDNESDAY_11PM_IST = new Date('2026-07-29T17:30:00Z'); // 23:00 IST
const WEDNESDAY_0559_IST = new Date('2026-07-29T00:29:00Z'); // 05:59 IST
const WEDNESDAY_0600_IST = new Date('2026-07-29T00:30:00Z'); // 06:00 IST
const WEDNESDAY_2200_IST = new Date('2026-07-29T16:30:00Z'); // 22:00 IST
const SUNDAY_NOON_IST = new Date('2026-08-02T06:30:00Z'); // Sun 12:00 IST
const SUNDAY_11PM_IST = new Date('2026-08-02T17:30:00Z'); // Sun 23:00 IST
const HOLIDAY_NOON_IST = new Date('2026-08-15T06:30:00Z'); // Sat 15 Aug 12:00 IST

function line(label: string, paise: bigint, quantity = 1, gstRatePct = 18) {
  return { label, unitPricePaise: paise, quantity, gstRatePct };
}

function base(overrides: Partial<PriceInput> = {}): PriceInput {
  return {
    serviceLines: [line('Kitchen sink unclogging (manual)', 34900n)],
    urgencyTier: 'E2',
    surgeMultiplierX100: 100,
    ...overrides,
  };
}

const price = (input: PriceInput, now = WEDNESDAY_2PM_IST, rules = RULES) =>
  computePrice(input, rules, now);

// ── steps 1–3: base lines ───────────────────────────────────────────────────

describe('steps 1–3 · line subtotal, add-ons, materials', () => {
  it('prices a single fixed service with 18% GST', () => {
    const b = price(base());
    expect(b.taxableTotalPaise).toBe(34900n);
    expect(b.gstTotalPaise).toBe(6282n); // 34900 × 18% exactly
    expect(b.totalPaise).toBe(41182n);
  });

  it('multiplies unit price by quantity (PER_UNIT)', () => {
    const b = price(base({ serviceLines: [line('Tap installation', 19900n, 3)] }));
    expect(b.taxableTotalPaise).toBe(59700n);
  });

  it('adds add-on lines into the labour subtotal', () => {
    const b = price(base({ addOnLines: [line('Foreign object retrieval', 10000n)] }));
    expect(b.taxableTotalPaise).toBe(44900n);
    expect(b.gstTotalPaise).toBe(8082n);
  });

  it('adds material lines (on-site quote)', () => {
    const b = price(base({ materialLines: [line('CPVC pipe 1m', 25000n)] }));
    expect(b.taxableTotalPaise).toBe(59900n);
  });

  it('rejects an empty service-line list', () => {
    expect(() => price(base({ serviceLines: [] }))).toThrow(ValidationError);
  });

  it('rejects negative unit prices (negative-guard)', () => {
    expect(() => price(base({ serviceLines: [line('bad', -100n)] }))).toThrow(ValidationError);
  });

  it('rejects zero and fractional quantities', () => {
    expect(() => price(base({ serviceLines: [line('bad', 100n, 0)] }))).toThrow(ValidationError);
    expect(() => price(base({ serviceLines: [line('bad', 100n, 1.5)] }))).toThrow(ValidationError);
  });

  it('a 0% GST line produces no GST row', () => {
    const b = price(base({ serviceLines: [line('exempt', 10000n, 1, 0)] }));
    expect(b.gstTotalPaise).toBe(0n);
    expect(b.lines.find((l) => l.code === 'GST')).toBeUndefined();
  });
});

// ── step 4: surge ───────────────────────────────────────────────────────────

describe('step 4 · surge multiplier (frozen, capped)', () => {
  it('applies 1.5× surge', () => {
    const b = price(base({ surgeMultiplierX100: 150 }));
    expect(b.taxableTotalPaise).toBe(52350n); // 34900 × 1.5
    expect(b.meta.surgeAppliedX100).toBe(150);
  });

  it('hard-caps surge at the rule cap (2.0×)', () => {
    const b = price(base({ surgeMultiplierX100: 260 }));
    expect(b.meta.surgeAppliedX100).toBe(200);
    expect(b.taxableTotalPaise).toBe(69800n);
  });

  it('rejects surge below 1.0×', () => {
    expect(() => price(base({ surgeMultiplierX100: 90 }))).toThrow(ValidationError);
  });

  it('AMC Plus caps the surge the member experiences at 1.25×', () => {
    const b = price(
      base({
        surgeMultiplierX100: 200,
        amc: { repairDiscountPct: 0, zeroEmergencyFee: true, surgeCapX100: 125 },
      }),
    );
    expect(b.meta.surgeAppliedX100).toBe(125);
    expect(b.taxableTotalPaise).toBe(43625n); // 34900 × 1.25
  });

  it('labels the surge row for the customer app', () => {
    const b = price(base({ surgeMultiplierX100: 150 }));
    const surge = b.lines.find((l) => l.code === 'SURGE');
    expect(surge?.label).toBe('High-demand surcharge (1.5×)');
    expect(surge?.amountPaise).toBe(17450n);
  });
});

// ── step 5: time multiplier ─────────────────────────────────────────────────

describe('step 5 · time multiplier (IST, max not product)', () => {
  const flat = base({ serviceLines: [line('svc', 10000n, 1, 0)] }); // GST 0 keeps numbers plain

  it('23:00 IST is night → 1.5×', () => {
    const b = price(flat, WEDNESDAY_11PM_IST);
    expect(b.meta.timeAppliedX100).toBe(150);
    expect(b.meta.timeReason).toBe('NIGHT');
    expect(b.taxableTotalPaise).toBe(15000n);
  });

  it('05:59 IST is still night; 06:00 IST is not', () => {
    expect(price(flat, WEDNESDAY_0559_IST).meta.timeAppliedX100).toBe(150);
    expect(price(flat, WEDNESDAY_0600_IST).meta.timeAppliedX100).toBe(100);
  });

  it('22:00 IST starts the night window', () => {
    expect(price(flat, WEDNESDAY_2200_IST).meta.timeAppliedX100).toBe(150);
  });

  it('Sunday daytime → 1.25×', () => {
    const b = price(flat, SUNDAY_NOON_IST);
    expect(b.meta.timeAppliedX100).toBe(125);
    expect(b.meta.timeReason).toBe('SUNDAY');
  });

  it('a configured holiday date → 1.25×', () => {
    const b = price(flat, HOLIDAY_NOON_IST);
    expect(b.meta.timeAppliedX100).toBe(125);
    expect(b.meta.timeReason).toBe('HOLIDAY');
  });

  it('Sunday NIGHT takes the max (1.5×), never the product (1.875×)', () => {
    const b = price(flat, SUNDAY_11PM_IST);
    expect(b.meta.timeAppliedX100).toBe(150);
    expect(b.taxableTotalPaise).toBe(15000n); // not 18750
  });

  it('weekday daytime adds no TIME row', () => {
    const b = price(flat, WEDNESDAY_2PM_IST);
    expect(b.meta.timeAppliedX100).toBe(100);
    expect(b.meta.timeReason).toBe('NONE');
    expect(b.lines.find((l) => l.code === 'TIME')).toBeUndefined();
  });

  it('surge × time compound in a single rounding step per line', () => {
    // 999 × (150 × 125 / 10000) = 999 × 1.875 = 1873.125 → 1873 (HALF_UP)
    const b = price(
      base({ serviceLines: [line('svc', 999n, 1, 0)], surgeMultiplierX100: 150 }),
      SUNDAY_NOON_IST,
    );
    expect(b.taxableTotalPaise).toBe(1873n);
  });
});

// ── step 6: emergency fee ───────────────────────────────────────────────────

describe('step 6 · emergency fee', () => {
  it('E0 adds the ₹499 SOS fee', () => {
    const b = price(base({ urgencyTier: 'E0' }));
    expect(b.meta.emergencyFeePaise).toBe(49900n);
    expect(b.lines.find((l) => l.code === 'EMERGENCY_FEE')?.label).toBe('SOS emergency fee');
  });

  it('E1 adds the ₹299 fee', () => {
    const b = price(base({ urgencyTier: 'E1' }));
    expect(b.meta.emergencyFeePaise).toBe(29900n);
  });

  it('E1 fee is waived when the pre-multiplier subtotal exceeds ₹1500', () => {
    const b = price(base({ urgencyTier: 'E1', serviceLines: [line('big', 150100n)] }));
    expect(b.meta.emergencyFeePaise).toBe(0n);
    expect(b.meta.emergencyFeeWaived).toBe(true);
  });

  it('E1 fee is NOT waived at exactly ₹1500 (strictly greater)', () => {
    const b = price(base({ urgencyTier: 'E1', serviceLines: [line('big', 150000n)] }));
    expect(b.meta.emergencyFeePaise).toBe(29900n);
  });

  it('E0 fee is never waived by subtotal size', () => {
    const b = price(base({ urgencyTier: 'E0', serviceLines: [line('big', 500000n)] }));
    expect(b.meta.emergencyFeePaise).toBe(49900n);
  });

  it('AMC Plus zeroes the emergency fee', () => {
    const b = price(
      base({ urgencyTier: 'E0', amc: { repairDiscountPct: 20, zeroEmergencyFee: true } }),
    );
    expect(b.meta.emergencyFeePaise).toBe(0n);
    expect(b.meta.emergencyFeeWaived).toBe(true);
  });

  it('the fee is added AFTER multipliers — surge never touches it', () => {
    const b = price(
      base({
        urgencyTier: 'E0',
        surgeMultiplierX100: 200,
        serviceLines: [line('svc', 10000n, 1, 0)],
      }),
    );
    // taxable = 10000×2 + 49900 (fee un-surged)
    expect(b.taxableTotalPaise).toBe(69900n);
  });

  it('the fee itself is taxed at the fee GST rate', () => {
    const b = price(base({ urgencyTier: 'E0', serviceLines: [line('svc', 10000n, 1, 0)] }));
    expect(b.gstTotalPaise).toBe(8982n); // 18% of 49900 only
  });

  it('E2 and E3 carry no fee', () => {
    expect(price(base({ urgencyTier: 'E2' })).meta.emergencyFeePaise).toBe(0n);
    expect(price(base({ urgencyTier: 'E3' })).meta.emergencyFeePaise).toBe(0n);
  });
});

// ── step 7: AMC discount ────────────────────────────────────────────────────

describe('step 7 · AMC discount (labour only)', () => {
  it('discounts labour by the plan percentage', () => {
    const b = price(
      base({
        serviceLines: [line('svc', 100000n, 1, 0)],
        amc: { repairDiscountPct: 10, zeroEmergencyFee: false },
      }),
    );
    expect(b.taxableTotalPaise).toBe(90000n);
    expect(b.lines.find((l) => l.code === 'AMC_DISCOUNT')?.amountPaise).toBe(-10000n);
  });

  it('NEVER discounts materials', () => {
    const b = price(
      base({
        serviceLines: [line('labour', 100000n, 1, 0)],
        materialLines: [line('parts', 50000n, 1, 0)],
        amc: { repairDiscountPct: 10, zeroEmergencyFee: false },
      }),
    );
    // 100000 − 10000 (labour only) + 50000 untouched
    expect(b.taxableTotalPaise).toBe(140000n);
  });

  it('covers add-ons (they are labour)', () => {
    const b = price(
      base({
        serviceLines: [line('svc', 50000n, 1, 0)],
        addOnLines: [line('addon', 50000n, 1, 0)],
        amc: { repairDiscountPct: 10, zeroEmergencyFee: false },
      }),
    );
    expect(b.taxableTotalPaise).toBe(90000n);
  });

  it('0% plans add no discount row', () => {
    const b = price(base({ amc: { repairDiscountPct: 0, zeroEmergencyFee: false } }));
    expect(b.lines.find((l) => l.code === 'AMC_DISCOUNT')).toBeUndefined();
  });
});

// ── step 8: coupon ──────────────────────────────────────────────────────────

describe('step 8 · coupon (after AMC, floor at zero)', () => {
  it('applies a flat coupon', () => {
    const b = price(
      base({
        serviceLines: [line('svc', 100000n, 1, 0)],
        coupon: { kind: 'FLAT', flatPaise: 10000n },
      }),
    );
    expect(b.taxableTotalPaise).toBe(90000n);
    expect(b.lines.find((l) => l.code === 'COUPON')?.amountPaise).toBe(-10000n);
  });

  it('applies a percentage coupon', () => {
    const b = price(
      base({
        serviceLines: [line('svc', 100000n, 1, 0)],
        coupon: { kind: 'PERCENT', percent: 15 },
      }),
    );
    expect(b.taxableTotalPaise).toBe(85000n);
  });

  it('caps a percentage coupon at maxDiscountPaise', () => {
    const b = price(
      base({
        serviceLines: [line('svc', 100000n, 1, 0)],
        coupon: { kind: 'PERCENT', percent: 50, maxDiscountPaise: 20000n },
      }),
    );
    expect(b.taxableTotalPaise).toBe(80000n);
  });

  it('stacks AFTER the AMC discount (order matters)', () => {
    const b = price(
      base({
        serviceLines: [line('svc', 100000n, 1, 0)],
        amc: { repairDiscountPct: 10, zeroEmergencyFee: false },
        coupon: { kind: 'PERCENT', percent: 10 },
      }),
    );
    // 100000 → −10% AMC = 90000 → −10% coupon of the REMAINDER = 81000
    expect(b.taxableTotalPaise).toBe(81000n);
  });

  it('floors at zero when the coupon exceeds the total', () => {
    const b = price(
      base({
        serviceLines: [line('svc', 10000n, 1, 0)],
        coupon: { kind: 'FLAT', flatPaise: 50000n },
      }),
    );
    expect(b.taxableTotalPaise).toBe(0n);
    expect(b.gstTotalPaise).toBe(0n);
    expect(b.totalPaise).toBe(0n);
    expect(b.lines.find((l) => l.code === 'COUPON')?.amountPaise).toBe(-10000n); // clamped
  });

  it('a percent coupon applies to the emergency fee too (spec sequence)', () => {
    const b = price(
      base({
        urgencyTier: 'E0',
        serviceLines: [line('svc', 10000n, 1, 0)],
        coupon: { kind: 'PERCENT', percent: 10 },
      }),
    );
    // (10000 + 49900) × 90%
    expect(b.taxableTotalPaise).toBe(53910n);
  });
});

// ── step 9: GST ─────────────────────────────────────────────────────────────

describe('step 9 · GST per line, rounded per line, then summed', () => {
  it('per-line rounding beats total-rounding (audit-reproducible)', () => {
    // each line: 25 × 18% = 4.5 → 5; two lines ⇒ 10. A single total-level
    // rounding would give round(50 × 18%) = 9 — that would be wrong.
    const b = price(base({ serviceLines: [line('a', 25n), line('b', 25n)] }));
    expect(b.gstTotalPaise).toBe(10n);
  });

  it('groups GST rows by rate, sorted ascending', () => {
    const b = price(
      base({
        serviceLines: [line('svc-18', 10000n, 1, 18)],
        materialLines: [line('mat-5', 10000n, 1, 5)],
      }),
    );
    const gstRows = b.lines.filter((l) => l.code === 'GST');
    expect(gstRows.map((r) => r.label)).toEqual(['GST 5%', 'GST 18%']);
    expect(gstRows.map((r) => r.amountPaise)).toEqual([500n, 1800n]);
    expect(b.gstTotalPaise).toBe(2300n);
  });

  it('total = taxable + GST, always', () => {
    for (const input of [
      base(),
      base({ urgencyTier: 'E0', surgeMultiplierX100: 173 }),
      base({
        serviceLines: [line('x', 33333n, 3, 18)],
        materialLines: [line('m', 777n, 7, 5)],
        amc: { repairDiscountPct: 20, zeroEmergencyFee: false },
        coupon: { kind: 'PERCENT', percent: 7 },
      }),
    ]) {
      const b = price(input, SUNDAY_11PM_IST);
      expect(b.totalPaise).toBe(b.taxableTotalPaise + b.gstTotalPaise);
    }
  });
});

// ── breakdown & purity ──────────────────────────────────────────────────────

describe('breakdown & purity', () => {
  it('emits one labelled row per booked line, in booking order', () => {
    const b = price(
      base({
        serviceLines: [line('Tap / faucet leak repair', 19900n)],
        addOnLines: [line('Extra washer set', 5000n)],
        materialLines: [line('O-ring pack', 3000n)],
      }),
    );
    expect(b.lines.slice(0, 3)).toEqual([
      { code: 'ITEM', label: 'Tap / faucet leak repair', amountPaise: 19900n },
      { code: 'ADD_ON', label: 'Extra washer set', amountPaise: 5000n },
      { code: 'MATERIAL', label: 'O-ring pack', amountPaise: 3000n },
    ]);
  });

  it('is deterministic — same inputs, same output', () => {
    const input = base({ urgencyTier: 'E1', surgeMultiplierX100: 140 });
    expect(price(input, SUNDAY_NOON_IST)).toEqual(price(input, SUNDAY_NOON_IST));
  });

  it('never consults the ambient clock or RNG', () => {
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('pricing must not call Date.now()');
    });
    const rndSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('pricing must not call Math.random()');
    });
    try {
      expect(() => price(base({ urgencyTier: 'E0', surgeMultiplierX100: 180 }))).not.toThrow();
    } finally {
      nowSpy.mockRestore();
      rndSpy.mockRestore();
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});

// ── allocateProRata ─────────────────────────────────────────────────────────

describe('allocateProRata', () => {
  const m = (n: bigint) => n as Money;

  it('parts always sum to the total (largest remainder)', () => {
    expect(allocateProRata(m(10n), [m(1n), m(1n), m(1n)])).toEqual([4n, 3n, 3n]);
    expect(allocateProRata(m(100n), [m(999n), m(1n)])).toEqual([100n, 0n]);
    expect(allocateProRata(m(7n), [m(2n), m(3n), m(5n)]).reduce((a, b) => a + b, 0n)).toBe(7n);
  });

  it('handles zero totals and zero weights', () => {
    expect(allocateProRata(m(0n), [m(5n), m(5n)])).toEqual([0n, 0n]);
    expect(allocateProRata(m(9n), [m(0n), m(0n)])).toEqual([0n, 0n]);
  });

  it('is proportional for exact divisions', () => {
    expect(allocateProRata(m(100n), [m(75n), m(25n)])).toEqual([75n, 25n]);
  });
});
