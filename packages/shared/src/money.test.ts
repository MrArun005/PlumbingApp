import { describe, expect, it } from 'vitest';
import {
  ZERO,
  add,
  format,
  max,
  maxZero,
  min,
  money,
  mulRational,
  rupees,
  sub,
  sum,
  toPaiseString,
} from './money';

describe('money() constructor', () => {
  it('accepts bigint paise', () => {
    expect(money(19900n)).toBe(19900n);
  });

  it('accepts safe integer numbers', () => {
    expect(money(19900)).toBe(19900n);
  });

  it('accepts integer strings (JSON boundary form)', () => {
    expect(money('19900')).toBe(19900n);
    expect(money('-500')).toBe(-500n);
  });

  it('rejects fractional numbers — paise are indivisible', () => {
    expect(() => money(199.5)).toThrow(TypeError);
  });

  it('rejects unsafe integers', () => {
    expect(() => money(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });

  it('rejects non-integer strings', () => {
    expect(() => money('199.00')).toThrow(TypeError);
    expect(() => money('₹199')).toThrow(TypeError);
    expect(() => money('')).toThrow(TypeError);
  });
});

describe('rupees()', () => {
  it('converts whole rupees to paise', () => {
    expect(rupees(199)).toBe(19900n);
    expect(rupees(0)).toBe(0n);
  });

  it('rejects fractional rupees', () => {
    expect(() => rupees(199.99)).toThrow(TypeError);
  });
});

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(add(money(100n), money(250n))).toBe(350n);
    expect(sub(money(100n), money(250n))).toBe(-150n);
  });

  it('sums a list, empty list is zero', () => {
    expect(sum([money(1n), money(2n), money(3n)])).toBe(6n);
    expect(sum([])).toBe(ZERO);
  });
});

describe('mulRational — rounding', () => {
  it('applies 18% GST with HALF_UP', () => {
    // 19900 × 18 / 100 = 3582 exactly
    expect(mulRational(money(19900n), 18n, 100n)).toBe(3582n);
  });

  it('rounds .5 away from zero (HALF_UP)', () => {
    // 25 × 1/2 = 12.5 → 13
    expect(mulRational(money(25n), 1n, 2n)).toBe(13n);
    // −25 × 1/2 = −12.5 → −13 (away from zero)
    expect(mulRational(money(-25n), 1n, 2n)).toBe(-13n);
  });

  it('rounds below half down', () => {
    // 24 × 1/5 = 4.8 → 5 ; 21 × 1/5 = 4.2 → 4
    expect(mulRational(money(24n), 1n, 5n)).toBe(5n);
    expect(mulRational(money(21n), 1n, 5n)).toBe(4n);
  });

  it('supports FLOOR and CEIL explicitly', () => {
    expect(mulRational(money(25n), 1n, 2n, 'FLOOR')).toBe(12n);
    expect(mulRational(money(25n), 1n, 2n, 'CEIL')).toBe(13n);
    expect(mulRational(money(-25n), 1n, 2n, 'FLOOR')).toBe(-13n);
    expect(mulRational(money(-25n), 1n, 2n, 'CEIL')).toBe(-12n);
  });

  it('normalises a negative denominator', () => {
    expect(mulRational(money(100n), 1n, -4n)).toBe(-25n);
  });

  it('throws on zero denominator', () => {
    expect(() => mulRational(money(100n), 1n, 0n)).toThrow(RangeError);
  });

  it('surge 1.5× is exact via 3/2', () => {
    expect(mulRational(money(34900n), 3n, 2n)).toBe(52350n);
  });
});

describe('bounds helpers', () => {
  it('maxZero floors negatives at zero (coupon over-discount)', () => {
    expect(maxZero(money(-500n))).toBe(0n);
    expect(maxZero(money(500n))).toBe(500n);
  });

  it('min / max', () => {
    expect(min(money(1n), money(2n))).toBe(1n);
    expect(max(money(1n), money(2n))).toBe(2n);
  });
});

describe('format — Indian digit grouping', () => {
  it('formats lakhs/crores style', () => {
    expect(format(money(123456789n))).toBe('₹12,34,567.89');
  });

  it('pads paise to two digits', () => {
    expect(format(money(19905n))).toBe('₹199.05');
    expect(format(money(19900n))).toBe('₹199.00');
  });

  it('handles zero and negatives', () => {
    expect(format(ZERO)).toBe('₹0.00');
    expect(format(money(-49900n))).toBe('-₹499.00');
  });
});

describe('toPaiseString', () => {
  it('serialises for wire transport', () => {
    expect(toPaiseString(money(19900n))).toBe('19900');
    expect(toPaiseString(money(-1n))).toBe('-1');
  });
});
