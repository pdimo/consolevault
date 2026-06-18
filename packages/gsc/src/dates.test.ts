import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysInRange,
  isIsoDate,
  newestFinalizedDay,
  subtractMonths,
  todayPacific,
  windowFor,
} from './dates.js';

describe('pacific date utilities', () => {
  it('reports the PT calendar day for a known instant', () => {
    // 2026-06-18T05:30:00Z is 2026-06-17 22:30 PDT → still the 17th in Pacific Time.
    expect(todayPacific(new Date('2026-06-18T05:30:00Z'))).toBe('2026-06-17');
    // 2026-06-18T18:00:00Z is 2026-06-18 11:00 PDT.
    expect(todayPacific(new Date('2026-06-18T18:00:00Z'))).toBe('2026-06-18');
  });

  it('adds and subtracts whole days across month boundaries', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('computes the newest finalized day as today(PT) - offset', () => {
    expect(newestFinalizedDay(3, new Date('2026-06-18T18:00:00Z'))).toBe('2026-06-15');
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-06-18')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-6-1')).toBe(false);
    expect(isIsoDate('not-a-date')).toBe(false);
  });

  it('subtractMonths steps whole months back', () => {
    expect(subtractMonths('2026-06-18', 16)).toBe('2025-02-18');
    expect(subtractMonths('2026-01-15', 1)).toBe('2025-12-15');
  });

  it('daysInRange is inclusive and ascending', () => {
    expect(daysInRange('2026-06-13', '2026-06-15')).toEqual([
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
    ]);
    expect(daysInRange('2026-06-15', '2026-06-13')).toEqual([]);
  });

  it('windowFor: newest = today(PT)-offset, oldest = today-backfillMonths, clamped to 16mo', () => {
    const now = new Date('2026-06-18T18:00:00Z');
    expect(windowFor(3, 1, now)).toEqual({ oldest: '2026-05-18', newest: '2026-06-15' });
    expect(windowFor(3, 240, now).oldest).toBe('2025-02-18');
  });
});
