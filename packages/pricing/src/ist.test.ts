import { describe, expect, it } from 'vitest';
import { hourInWindow, istParts } from './ist';

describe('istParts', () => {
  it('converts UTC to IST (+05:30) hour, weekday and date', () => {
    // 2026-07-29T20:00Z = 2026-07-30 01:30 IST (Thursday)
    const p = istParts(new Date('2026-07-29T20:00:00Z'));
    expect(p).toEqual({ hour: 1, weekday: 4, date: '2026-07-30' });
  });

  it('detects IST Sunday even when UTC is still Saturday', () => {
    // Sat 2026-08-01T19:00Z = Sun 2026-08-02 00:30 IST
    const p = istParts(new Date('2026-08-01T19:00:00Z'));
    expect(p.weekday).toBe(0);
    expect(p.date).toBe('2026-08-02');
  });
});

describe('hourInWindow', () => {
  it('handles ordinary windows', () => {
    expect(hourInWindow(10, 9, 18)).toBe(true);
    expect(hourInWindow(18, 9, 18)).toBe(false);
  });

  it('handles windows that wrap midnight (22 → 6)', () => {
    expect(hourInWindow(23, 22, 6)).toBe(true);
    expect(hourInWindow(2, 22, 6)).toBe(true);
    expect(hourInWindow(6, 22, 6)).toBe(false);
    expect(hourInWindow(21, 22, 6)).toBe(false);
  });

  it('a zero-length window matches nothing', () => {
    expect(hourInWindow(5, 5, 5)).toBe(false);
  });
});
