import { describe, expect, it } from 'vitest';
import { computeMissingDays } from './planner.js';

const days = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];

describe('computeMissingDays', () => {
  it('returns only days that are not final-terminal', () => {
    expect(computeMissingDays(days, new Set(['2026-06-01', '2026-06-02']))).toEqual([
      '2026-06-03',
      '2026-06-04',
      '2026-06-05',
    ]);
  });

  it('returns empty when every day is final-terminal', () => {
    expect(computeMissingDays(days, new Set(days))).toEqual([]);
  });

  it('returns the whole window when nothing is terminal (fresh/pending days re-collect)', () => {
    expect(computeMissingDays(days, new Set())).toEqual(days);
  });
});
