import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from './errors';
import { paiseAmount, parseOrThrow, phoneE164In, pincode, trimmedString } from './zod-helpers';

describe('parseOrThrow', () => {
  const schema = z.object({ name: trimmedString });

  it('returns parsed data on success', () => {
    expect(parseOrThrow(schema, { name: '  Asha  ' }, 'POST /test')).toEqual({ name: 'Asha' });
  });

  it('throws our ValidationError (not a raw ZodError) with the boundary named', () => {
    try {
      parseOrThrow(schema, { name: '' }, 'POST /bookings');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      const err = e as ValidationError;
      expect(err.message).toContain('POST /bookings');
      expect(err.details['boundary']).toBe('POST /bookings');
      expect(Array.isArray(err.details['issues'])).toBe(true);
    }
  });
});

describe('phoneE164In', () => {
  it('accepts valid Indian mobiles', () => {
    expect(phoneE164In.parse('+919876543210')).toBe('+919876543210');
  });

  it.each(['9876543210', '+915876543210', '+91987654321', '+9198765432100', '+14155550123'])(
    'rejects %s',
    (bad) => {
      expect(() => phoneE164In.parse(bad)).toThrow();
    },
  );
});

describe('pincode', () => {
  it('accepts Bengaluru PINs', () => {
    expect(pincode.parse('560034')).toBe('560034');
  });

  it.each(['056034', '5600', '56003A'])('rejects %s', (bad) => {
    expect(() => pincode.parse(bad)).toThrow();
  });
});

describe('paiseAmount', () => {
  it('parses integer strings to branded Money (bigint)', () => {
    expect(paiseAmount.parse('19900')).toBe(19900n);
    expect(paiseAmount.parse('-500')).toBe(-500n);
  });

  it('parses safe integers', () => {
    expect(paiseAmount.parse(19900)).toBe(19900n);
  });

  it('rejects floats and decorated strings', () => {
    expect(() => paiseAmount.parse(199.5)).toThrow();
    expect(() => paiseAmount.parse('199.00')).toThrow();
    expect(() => paiseAmount.parse('₹199')).toThrow();
  });
});
