/**
 * The canonical rank ladder — the one place bucket edges are defined.
 *
 * GSC exposes `position` as a single floating-point average per row, and that average lies whenever
 * the distribution is lopsided: rank 1 for one query plus rank 25 for twenty reports ~24, which
 * describes neither outcome. Bucketing restores the shape, so every rank view in the product reads
 * its edges from here — the rank-bucket heatmap, the ranking-tier trend, and the pre-aggregated
 * `gsc_views` BI views. One ladder means the app and Looker can never disagree about what "top 3"
 * means.
 *
 * Ranges are half-open on the raw float — `[min, max)`. A result averaging 3.4 is a rank-3 result,
 * not a "4–10" one.
 */

export interface RankBucket {
  /** SQL-safe identifier — used as the result column name and the API key. */
  key: string;
  /** Human label, e.g. `4–5`. */
  label: string;
  /** Inclusive lower bound on `position`. */
  min: number;
  /** Exclusive upper bound on `position`; `null` for the open-ended tail bucket. */
  max: number | null;
}

/** Fine-grained ladder (heatmap columns, BI views). Contiguous and gapless by construction. */
export const RANK_BUCKETS: readonly RankBucket[] = [
  { key: 'r1', label: '1', min: 1, max: 2 },
  { key: 'r2', label: '2', min: 2, max: 3 },
  { key: 'r3', label: '3', min: 3, max: 4 },
  { key: 'r4_5', label: '4–5', min: 4, max: 6 },
  { key: 'r6_10', label: '6–10', min: 6, max: 11 },
  { key: 'r11_20', label: '11–20', min: 11, max: 21 },
  { key: 'r21_50', label: '21–50', min: 21, max: 51 },
  { key: 'r51', label: '51+', min: 51, max: null },
] as const;

export interface RankTier {
  /** Result column name for the tier. */
  key: string;
  label: string;
  /** The `RANK_BUCKETS` keys this tier rolls up — always a contiguous run. */
  buckets: readonly string[];
}

/**
 * Coarse tiers for the over-time ranking-segment trend, where eight stacked bands would be
 * unreadable. Each tier is a contiguous run of `RANK_BUCKETS`, so the two ladders nest exactly.
 */
export const RANK_TIERS: readonly RankTier[] = [
  { key: 'top3', label: '1–3', buckets: ['r1', 'r2', 'r3'] },
  { key: 'p4_10', label: '4–10', buckets: ['r4_5', 'r6_10'] },
  { key: 'p11_20', label: '11–20', buckets: ['r11_20'] },
  { key: 'p21_50', label: '21–50', buckets: ['r21_50'] },
  { key: 'p50plus', label: '51+', buckets: ['r51'] },
] as const;

function bucketOf(key: string): RankBucket {
  const b = RANK_BUCKETS.find((x) => x.key === key);
  if (!b) throw new Error(`Unknown rank bucket: ${key}`);
  return b;
}

/**
 * SQL predicate matching a `[min, max)` range on `col`. The first bucket drops its lower bound so a
 * stray sub-1 position still lands somewhere rather than falling out of the ladder entirely.
 */
function rangePredicate(min: number, max: number | null, col: string): string {
  const parts: string[] = [];
  if (min > RANK_BUCKETS[0]!.min) parts.push(`${col} >= ${min}`);
  if (max !== null) parts.push(`${col} < ${max}`);
  return parts.length ? parts.join(' AND ') : `${col} IS NOT NULL`;
}

/** SQL predicate that is true for rows falling in `bucket`. */
export function rankBucketPredicate(bucket: RankBucket, col = 'position'): string {
  return rangePredicate(bucket.min, bucket.max, col);
}

/** SQL predicate for a coarse tier — the range spanned by its member buckets. */
export function rankTierPredicate(tier: RankTier, col = 'position'): string {
  const members = tier.buckets.map(bucketOf);
  return rangePredicate(members[0]!.min, members[members.length - 1]!.max, col);
}

/** `CASE` expression returning a row's bucket label — the BI views' `rank_bucket` dimension. */
export function rankBucketCaseSql(col = 'position'): string {
  const whens = RANK_BUCKETS.map(
    (b) => `WHEN ${rankBucketPredicate(b, col)} THEN '${b.label}'`,
  ).join('\n    ');
  return `CASE\n    ${whens}\n  END`;
}

/**
 * `CASE` expression returning a row's 1-based bucket ordinal. BI tools sort a string dimension
 * alphabetically ('11–20' before '4–5'), so the views expose this alongside the label to sort on.
 */
export function rankBucketIndexCaseSql(col = 'position'): string {
  const whens = RANK_BUCKETS.map(
    (b, i) => `WHEN ${rankBucketPredicate(b, col)} THEN ${i + 1}`,
  ).join('\n    ');
  return `CASE\n    ${whens}\n  END`;
}
