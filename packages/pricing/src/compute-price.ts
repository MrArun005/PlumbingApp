/**
 * The PipeFix pricing engine. PURE: no DB, no network, no Date.now(), no
 * randomness — every input arrives as an argument, including `now`.
 *
 * Order of operations is FIXED by the build prompt and implemented in this
 * exact sequence:
 *
 *   1. line subtotal (service items)      4. × surge (frozen, capped)
 *   2. + add-ons                          5. × time (night/Sunday — MAX, not product)
 *   3. + materials (on-site quote only)   6. + emergency fee (E1 waivable)
 *   7. − AMC discount (labour only)       8. − coupon (after AMC, floor 0)
 *   9. + GST (per-line rate, rounded per line, then summed)
 *
 * Implementation note: steps 4–9 are computed PER LINE (one rounding per
 * line, discounts allocated pro-rata with largest-remainder so sums stay
 * exact) and the aggregate breakdown rows are derived from those per-line
 * values. That is what makes per-line GST reproducible on the invoice.
 */
import { ZERO, min as moneyMin, money, mulRational, type Money } from '@pipefix/shared';
import { parseOrThrow } from '@pipefix/shared';
import { hourInWindow, istParts } from './ist';
import {
  priceInputSchema,
  priceRuleSetSchema,
  type BreakdownLine,
  type PriceBreakdown,
  type PriceInput,
  type PriceRuleSet,
} from './types';

interface WorkLine {
  label: string;
  kind: 'LABOUR' | 'MATERIAL' | 'FEE';
  code: 'ITEM' | 'ADD_ON' | 'MATERIAL' | 'EMERGENCY_FEE';
  gstRatePct: number;
  base: Money; // unit × qty (steps 1–3)
  eff: Money; // after surge × time (steps 4–5); fees skip multipliers
  discount: Money; // AMC + coupon allocated to this line (steps 7–8)
}

/**
 * Split `total` across lines proportionally to `weights`, in integer paise,
 * such that the parts sum to exactly `total` (largest-remainder method).
 */
export function allocateProRata(total: Money, weights: readonly Money[]): Money[] {
  const weightSum = weights.reduce((a, w) => a + w, 0n);
  if (weightSum === 0n || total === 0n) return weights.map(() => ZERO);

  const floors = weights.map((w) => ((total * w) / weightSum) as Money);
  const remainders = weights.map((w, i) => ({ i, rem: (total * w) % weightSum }));
  let leftover = total - floors.reduce((a, f) => a + f, 0n);

  // hand out the leftover paise to the largest remainders first (stable on ties)
  remainders.sort((a, b) => (a.rem === b.rem ? a.i - b.i : b.rem > a.rem ? 1 : -1));
  const result = [...floors];
  for (const { i } of remainders) {
    if (leftover === 0n) break;
    result[i] = ((result[i] as bigint) + 1n) as Money;
    leftover -= 1n;
  }
  return result;
}

export function computePrice(input: PriceInput, rules: PriceRuleSet, now: Date): PriceBreakdown {
  const inp = parseOrThrow(priceInputSchema, input, 'computePrice.input');
  const ruleSet = parseOrThrow(priceRuleSetSchema, rules, 'computePrice.rules');

  // ── steps 1–3: base lines ────────────────────────────────────────────────
  const lines: WorkLine[] = [];
  const pushLines = (
    items: typeof inp.serviceLines,
    kind: WorkLine['kind'],
    code: WorkLine['code'],
  ): void => {
    for (const item of items) {
      const base = mulRational(money(item.unitPricePaise), BigInt(item.quantity), 1n);
      lines.push({
        label: item.label,
        kind,
        code,
        gstRatePct: item.gstRatePct,
        base,
        eff: base,
        discount: ZERO,
      });
    }
  };
  pushLines(inp.serviceLines, 'LABOUR', 'ITEM');
  pushLines(inp.addOnLines, 'LABOUR', 'ADD_ON');
  pushLines(inp.materialLines, 'MATERIAL', 'MATERIAL');

  const step3Subtotal = lines.reduce<Money>((a, l) => (a + l.base) as Money, ZERO);

  // ── step 4: surge, frozen at booking, hard-capped (AMC may cap it lower) ─
  let surgeX100 = Math.min(inp.surgeMultiplierX100, ruleSet.surge.capX100);
  if (inp.amc?.surgeCapX100 !== undefined) surgeX100 = Math.min(surgeX100, inp.amc.surgeCapX100);

  // ── step 5: time multiplier — night vs Sunday/holiday take MAX, never both
  const ist = istParts(now);
  const isNight = hourInWindow(ist.hour, ruleSet.night.startHourIst, ruleSet.night.endHourIst);
  const isHolidayDate = ruleSet.holiday.holidayDatesIst.includes(ist.date);
  const isSunday = ruleSet.holiday.sundays && ist.weekday === 0;
  const nightX100 = isNight ? ruleSet.night.multiplierX100 : 100;
  const holidayX100 = isHolidayDate || isSunday ? ruleSet.holiday.multiplierX100 : 100;
  const timeX100 = Math.max(nightX100, holidayX100);
  const timeReason: PriceBreakdown['meta']['timeReason'] =
    timeX100 === 100
      ? 'NONE'
      : nightX100 >= holidayX100
        ? 'NIGHT'
        : isSunday
          ? 'SUNDAY'
          : 'HOLIDAY';

  // apply both multipliers in ONE rational per line (single rounding step)
  for (const line of lines) {
    line.eff = mulRational(line.base, BigInt(surgeX100) * BigInt(timeX100), 10_000n);
  }
  // display amounts: surge on base, time on the surged value
  const surgeAmount = lines.reduce<Money>(
    (a, l) => (a + (mulRational(l.base, BigInt(surgeX100), 100n) - l.base)) as Money,
    ZERO,
  );
  const timeAmount = lines.reduce<Money>((a, l) => (a + l.eff) as Money, ZERO) as bigint as Money;
  const effTotalBeforeFee = timeAmount;
  const timeDisplay = (effTotalBeforeFee - step3Subtotal - surgeAmount) as Money;

  // ── step 6: emergency fee ────────────────────────────────────────────────
  let feePaise: Money = ZERO;
  let feeWaived = false;
  if (inp.urgencyTier === 'E0') feePaise = money(ruleSet.emergencyFee.e0Paise);
  if (inp.urgencyTier === 'E1') {
    if (step3Subtotal > money(ruleSet.emergencyFee.e1WaiverSubtotalOverPaise)) {
      feeWaived = true;
    } else {
      feePaise = money(ruleSet.emergencyFee.e1Paise);
    }
  }
  if (inp.amc?.zeroEmergencyFee && feePaise > 0n) {
    feePaise = ZERO;
    feeWaived = true;
  }
  const feeLabel = inp.urgencyTier === 'E0' ? 'SOS emergency fee' : 'Urgent-response fee';
  if (feePaise > 0n) {
    lines.push({
      label: feeLabel,
      kind: 'FEE',
      code: 'EMERGENCY_FEE',
      gstRatePct: ruleSet.emergencyFee.gstRatePct,
      base: feePaise,
      eff: feePaise, // fees are added AFTER multipliers, never surged
      discount: ZERO,
    });
  }

  // ── step 7: AMC discount — LABOUR lines only, never materials or fees ────
  let amcDiscount: Money = ZERO;
  if (inp.amc && inp.amc.repairDiscountPct > 0) {
    const labour = lines.filter((l) => l.kind === 'LABOUR');
    const labourEff = labour.reduce<Money>((a, l) => (a + l.eff) as Money, ZERO);
    amcDiscount = mulRational(labourEff, BigInt(inp.amc.repairDiscountPct), 100n);
    const parts = allocateProRata(
      amcDiscount,
      labour.map((l) => l.eff),
    );
    // allocateProRata returns exactly one part per weight
    labour.forEach((l, i) => {
      l.discount = (l.discount + (parts[i] as Money)) as Money;
    });
  }

  // ── step 8: coupon — after AMC, floored at zero ──────────────────────────
  let couponDiscount: Money = ZERO;
  if (inp.coupon) {
    const remaining = lines.map((l) => (l.eff - l.discount) as Money);
    const remainingTotal = remaining.reduce<Money>((a, v) => (a + v) as Money, ZERO);
    couponDiscount =
      inp.coupon.kind === 'FLAT'
        ? money(inp.coupon.flatPaise)
        : mulRational(remainingTotal, BigInt(inp.coupon.percent), 100n);
    if (inp.coupon.kind === 'PERCENT' && inp.coupon.maxDiscountPaise !== undefined) {
      couponDiscount = moneyMin(couponDiscount, money(inp.coupon.maxDiscountPaise));
    }
    couponDiscount = moneyMin(couponDiscount, remainingTotal); // zero-floor
    const parts = allocateProRata(couponDiscount, remaining);
    // allocateProRata returns exactly one part per weight
    lines.forEach((l, i) => {
      l.discount = (l.discount + (parts[i] as Money)) as Money;
    });
  }

  // ── step 9: GST per line (SAC rate), rounded per line, then summed ───────
  const gstByRate = new Map<number, Money>();
  let taxableTotal: Money = ZERO;
  let gstTotal: Money = ZERO;
  for (const line of lines) {
    const taxable = (line.eff - line.discount) as Money;
    const gst = mulRational(taxable, BigInt(line.gstRatePct), 100n);
    taxableTotal = (taxableTotal + taxable) as Money;
    gstTotal = (gstTotal + gst) as Money;
    if (gst > 0n)
      gstByRate.set(line.gstRatePct, ((gstByRate.get(line.gstRatePct) ?? ZERO) + gst) as Money);
  }

  // ── breakdown the customer app renders directly ──────────────────────────
  const out: BreakdownLine[] = lines
    .filter((l) => l.code !== 'EMERGENCY_FEE')
    .map((l) => ({ code: l.code as BreakdownLine['code'], label: l.label, amountPaise: l.base }));
  if (surgeAmount > 0n) {
    out.push({
      code: 'SURGE',
      label: `High-demand surcharge (${fmtX(surgeX100)}×)`,
      amountPaise: surgeAmount,
    });
  }
  if (timeDisplay > 0n) {
    const label =
      timeReason === 'NIGHT'
        ? `Night-hours surcharge (${fmtX(timeX100)}×)`
        : `Sunday/holiday surcharge (${fmtX(timeX100)}×)`;
    out.push({ code: 'TIME', label, amountPaise: timeDisplay });
  }
  if (feePaise > 0n) {
    out.push({ code: 'EMERGENCY_FEE', label: feeLabel, amountPaise: feePaise });
  }
  if (amcDiscount > 0n) {
    out.push({
      code: 'AMC_DISCOUNT',
      label: `AMC member discount (${inp.amc?.repairDiscountPct}% on labour)`,
      amountPaise: -amcDiscount,
    });
  }
  if (couponDiscount > 0n) {
    out.push({ code: 'COUPON', label: 'Coupon discount', amountPaise: -couponDiscount });
  }
  for (const [rate, amount] of [...gstByRate.entries()].sort((a, b) => a[0] - b[0])) {
    out.push({ code: 'GST', label: `GST ${rate}%`, amountPaise: amount });
  }

  return {
    lines: out,
    totalPaise: (taxableTotal + gstTotal) as bigint,
    taxableTotalPaise: taxableTotal as bigint,
    gstTotalPaise: gstTotal as bigint,
    meta: {
      surgeAppliedX100: surgeX100,
      timeAppliedX100: timeX100,
      timeReason,
      emergencyFeePaise: feePaise as bigint,
      emergencyFeeWaived: feeWaived,
    },
  };
}

/** 150 → "1.5", 125 → "1.25", 200 → "2" */
function fmtX(x100: number): string {
  const s = (x100 / 100).toFixed(2);
  return s.replace(/\.?0+$/, '');
}
