import { describe, expect, it } from 'vitest';
import { capacityEstimate, GSC_LIMITS } from './limits.js';

describe('capacityEstimate', () => {
  it('reports tiny usage and huge headroom at small scale', () => {
    const r = capacityEstimate(300, 150); // 2 calls/property/day
    expect(r.avgCallsPerProperty).toBe(2);
    expect(r.projectQpdUsedPct).toBeLessThan(0.01);
    // ~ (30M - 300) / 2 properties of headroom — effectively unbounded for an agency
    expect(r.estMoreProperties).toBeGreaterThan(10_000_000);
  });

  it('handles zero usage (no estimate yet)', () => {
    const r = capacityEstimate(0, 0);
    expect(r.avgCallsPerProperty).toBe(0);
    expect(r.estMoreProperties).toBeNull();
  });

  it('uses the per-project daily quota as the volume ceiling', () => {
    const r = capacityEstimate(GSC_LIMITS.perProjectQpd, 1000);
    expect(r.projectQpdUsedPct).toBe(100);
    expect(r.estMoreProperties).toBe(0);
  });
});
