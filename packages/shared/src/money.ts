/**
 * Money — the ONLY way currency moves through this codebase.
 *
 * Rule 1 of the build prompt: money is `bigint` paise (1 rupee = 100 paise).
 * Never `number`, never floats. The brand below makes it a compile error to
 * pass a plain bigint where Money is expected, so every amount is forced
 * through the `money()` constructor and its validation.
 */

declare const MoneyBrand: unique symbol;

/** An amount in paise. Negative values are allowed (refunds, ledger debits). */
export type Money = bigint & { readonly [MoneyBrand]: 'paise' };

export const ZERO: Money = 0n as Money;

export type RoundingMode = 'HALF_UP' | 'FLOOR' | 'CEIL';

/**
 * Construct Money from paise. Accepts bigint, a whole number, or a numeric
 * string (handy at JSON boundaries, where bigint cannot travel natively).
 */
export function money(paise: bigint | number | string): Money {
  if (typeof paise === 'bigint') return paise as Money;
  if (typeof paise === 'number') {
    if (!Number.isSafeInteger(paise)) {
      throw new TypeError(`Money must be an integer number of paise, got: ${paise}`);
    }
    return BigInt(paise) as Money;
  }
  if (!/^-?\d+$/.test(paise)) {
    throw new TypeError(`Money string must be an integer number of paise, got: "${paise}"`);
  }
  return BigInt(paise) as Money;
}

/** Convenience: whole rupees → Money. `rupees(199)` = ₹199.00 = 19900 paise. */
export function rupees(wholeRupees: bigint | number): Money {
  const r = typeof wholeRupees === 'bigint' ? wholeRupees : BigInt(assertInt(wholeRupees));
  return (r * 100n) as Money;
}

function assertInt(n: number): number {
  if (!Number.isSafeInteger(n)) throw new TypeError(`Expected a safe integer, got: ${n}`);
  return n;
}

export function add(a: Money, b: Money): Money {
  return (a + b) as Money;
}

export function sub(a: Money, b: Money): Money {
  return (a - b) as Money;
}

export function sum(amounts: readonly Money[]): Money {
  return amounts.reduce<Money>((acc, m) => add(acc, m), ZERO);
}

/**
 * Multiply by a rational number (numerator / denominator) with explicit
 * rounding. This is how percentages, surge multipliers and GST rates are
 * applied without ever leaving integer arithmetic.
 *
 * e.g. 18% GST on m:      mulRational(m, 18n, 100n)
 *      1.5× night surge:  mulRational(m, 3n, 2n)
 *
 * HALF_UP rounds half away from zero (the convention on Indian invoices).
 */
export function mulRational(
  m: Money,
  numerator: bigint,
  denominator: bigint,
  rounding: RoundingMode = 'HALF_UP',
): Money {
  if (denominator === 0n) throw new RangeError('mulRational: denominator must not be zero');
  // Normalise so the denominator is positive; sign lives in the product.
  const den = denominator < 0n ? -denominator : denominator;
  const product = denominator < 0n ? -(m * numerator) : m * numerator;

  const quotient = product / den; // truncates toward zero
  const remainder = product % den;
  if (remainder === 0n) return quotient as Money;

  const absRem = remainder < 0n ? -remainder : remainder;
  switch (rounding) {
    case 'HALF_UP':
      if (absRem * 2n >= den) return (quotient + (product < 0n ? -1n : 1n)) as Money;
      return quotient as Money;
    case 'FLOOR':
      return (product < 0n ? quotient - 1n : quotient) as Money;
    case 'CEIL':
      return (product < 0n ? quotient : quotient + 1n) as Money;
  }
}

/** Never go below zero — used for coupon floors ("floor at 0"). */
export function maxZero(m: Money): Money {
  return (m < 0n ? 0n : m) as Money;
}

export function min(a: Money, b: Money): Money {
  return (a < b ? a : b) as Money;
}

export function max(a: Money, b: Money): Money {
  return (a > b ? a : b) as Money;
}

const inGrouping = new Intl.NumberFormat('en-IN');

/**
 * Format for display with Indian digit grouping: 123456789n → "₹12,34,567.89".
 * Display-only — never parse this back into an amount.
 */
export function format(m: Money): string {
  const negative = m < 0n;
  const abs = negative ? -m : m;
  const rupeesPart = abs / 100n;
  const paisePart = abs % 100n;
  const grouped = inGrouping.format(rupeesPart);
  return `${negative ? '-' : ''}₹${grouped}.${paisePart.toString().padStart(2, '0')}`;
}

/** Serialise for JSON/DB-transport boundaries (bigint is not JSON-safe). */
export function toPaiseString(m: Money): string {
  return m.toString();
}
