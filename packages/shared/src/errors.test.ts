import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  IdempotencyKeyReusedError,
  InvalidTransitionError,
  NotFoundError,
  ValidationError,
} from './errors';

describe('error taxonomy', () => {
  it('every AppError carries a stable code and http status', () => {
    const err = new ValidationError('bad input');
    expect(err).toBeInstanceOf(AppError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.httpStatus).toBe(400);
    expect(err.name).toBe('ValidationError');
  });

  it('NotFoundError formats resource + id and exposes them in details', () => {
    const err = new NotFoundError('Booking', 'bkg_123');
    expect(err.message).toBe('Booking not found: bkg_123');
    expect(err.details).toEqual({ resource: 'Booking', id: 'bkg_123' });
    expect(err.httpStatus).toBe(404);
  });

  it('InvalidTransitionError is typed over the state union', () => {
    type BookingStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED';
    const err = new InvalidTransitionError<BookingStatus>('Booking', 'COMPLETED', 'DRAFT');
    expect(err.code).toBe('INVALID_TRANSITION');
    expect(err.from).toBe('COMPLETED');
    expect(err.to).toBe('DRAFT');
    expect(err.message).toBe('Illegal Booking transition: COMPLETED → DRAFT');
    expect(err.httpStatus).toBe(409);
  });

  it('toJSON produces a client-safe shape', () => {
    const err = new ConflictError('slot already taken', { slotId: 's1' });
    expect(err.toJSON()).toEqual({
      code: 'CONFLICT',
      message: 'slot already taken',
      details: { slotId: 's1' },
    });
  });

  it('idempotency reuse maps to 422', () => {
    const err = new IdempotencyKeyReusedError('key replayed with different body');
    expect(err.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(err.httpStatus).toBe(422);
  });
});
