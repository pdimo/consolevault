import { describe, expect, it } from 'vitest';
import { addDays, isIsoDate, newestFinalizedDay, todayPacific } from './dates.js';

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
});
