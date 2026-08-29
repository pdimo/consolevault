import { describe, expect, it } from 'vitest';
import {
  RANK_BUCKETS,
  RANK_TIERS,
  rankBucketCaseSql,
  rankBucketIndexCaseSql,
  rankBucketPredicate,
  rankTierPredicate,
} from './rank-buckets.js';

/** Which bucket a position falls into, by evaluating the ladder the way SQL would. */
function bucketFor(position: number): string | undefined {
  return RANK_BUCKETS.find((b) => position >= b.min && (b.max === null || position < b.max))?.key;
}

describe('RANK_BUCKETS', () => {
  it('is contiguous and gapless — every bucket starts where the previous one ends', () => {
    RANK_BUCKETS.forEach((b, i) => {
      const prev = RANK_BUCKETS[i - 1];
      if (prev) expect(b.min).toBe(prev.max);
    });
    expect(RANK_BUCKETS[RANK_BUCKETS.length - 1]!.max).toBeNull();
  });

  it('reads a fractional average as its floor rank — 3.4 is a rank-3 result', () => {
    expect(bucketFor(1)).toBe('r1');
    expect(bucketFor(3.4)).toBe('r3');
    expect(bucketFor(3.9)).toBe('r3');
    expect(bucketFor(4)).toBe('r4_5');
    expect(bucketFor(10.2)).toBe('r6_10');
    expect(bucketFor(50.9)).toBe('r21_50');
    expect(bucketFor(51)).toBe('r51');
    expect(bucketFor(400)).toBe('r51');
  });

  it('lets the first bucket catch anything below it rather than dropping the row', () => {
    expect(rankBucketPredicate(RANK_BUCKETS[0]!)).toBe('position < 2');
    expect(rankBucketPredicate(RANK_BUCKETS[3]!)).toBe('position >= 4 AND position < 6');
    expect(rankBucketPredicate(RANK_BUCKETS[7]!)).toBe('position >= 51');
  });
});

describe('RANK_TIERS', () => {
  it('nests exactly onto the fine ladder — every bucket belongs to exactly one tier', () => {
    const claimed = RANK_TIERS.flatMap((t) => t.buckets);
    expect([...claimed].sort()).toEqual([...RANK_BUCKETS.map((b) => b.key)].sort());
    expect(new Set(claimed).size).toBe(claimed.length);
  });

  it('spans its member buckets as one range', () => {
    expect(rankTierPredicate(RANK_TIERS[0]!)).toBe('position < 4');
    expect(rankTierPredicate(RANK_TIERS[1]!)).toBe('position >= 4 AND position < 11');
    expect(rankTierPredicate(RANK_TIERS[4]!)).toBe('position >= 51');
  });
});

describe('bucket CASE expressions', () => {
  it('labels every bucket and orders them 1..n', () => {
    const label = rankBucketCaseSql();
    for (const b of RANK_BUCKETS) expect(label).toContain(`THEN '${b.label}'`);
    const index = rankBucketIndexCaseSql();
    RANK_BUCKETS.forEach((_, i) => expect(index).toContain(`THEN ${i + 1}`));
  });

  it('buckets an alternative column when asked (the views bucket the source column)', () => {
    expect(rankBucketCaseSql('p')).toContain('p < 2');
  });
});
