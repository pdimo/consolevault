/**
 * Property-group union view SQL (SPEC §6.4). Combining isn't SUM: clicks/impressions add, but CTR
 * and position must be re-weighted (impression-weighted), encoded once here.
 */

import { DATASETS } from './schema.js';
import { rankBucketCaseSql, rankBucketIndexCaseSql } from './rank-buckets.js';

/**
 * Cross-property wildcard views (SPEC §6.1): one row-set spanning every property table in a data
 * dataset, with `source_table` identifying the property. Created in gsc_views as
 * byProperty_all / byPage_all / totals_all so Looker/SQL can query the whole warehouse at once.
 */
export const WILDCARD_VIEWS: ReadonlyArray<{ dataset: string; viewId: string }> = [
  { dataset: DATASETS.byProperty, viewId: 'byProperty_all' },
  { dataset: DATASETS.byPage, viewId: 'byPage_all' },
  { dataset: DATASETS.totals, viewId: 'totals_all' },
];

/**
 * Cross-property view over a data dataset. BigQuery `dataset.*` wildcards match TABLES only, not
 * views, so native-export properties (which are adapter VIEWS, SPEC §12) must be UNION'd in
 * explicitly by name — otherwise they vanish from the `_all` views (and from Home movers / Looker).
 * `hasApiTables` guards the wildcard term: an install with only native-export properties has no
 * matching tables, so `dataset.*` would error and is omitted.
 */
export function buildWildcardViewSql(
  projectId: string,
  dataset: string,
  nativeViewTables: readonly string[] = [],
  hasApiTables = true,
): string {
  const parts: string[] = [];
  if (hasApiTables) {
    parts.push(`SELECT *, _TABLE_SUFFIX AS source_table FROM \`${projectId}.${dataset}.*\``);
  }
  for (const t of nativeViewTables) {
    parts.push(`SELECT *, '${t}' AS source_table FROM \`${projectId}.${dataset}.${t}\``);
  }
  return parts.join('\n  UNION ALL ');
}

/**
 * Build the SELECT for a group's union view over member byProperty tables. Members are the
 * sanitized table names. Re-weights ctr/position by impressions.
 */
export function buildUnionViewSql(projectId: string, memberTables: string[]): string {
  const union = memberTables
    .map((t) => `SELECT * FROM \`${projectId}.${DATASETS.byProperty}.${t}\``)
    .join('\n    UNION ALL ');
  return `SELECT
    data_date, query, country, device,
    SUM(clicks) AS clicks,
    SUM(impressions) AS impressions,
    SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
    SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) AS position
  FROM (
    ${union}
  )
  GROUP BY data_date, query, country, device`;
}

/**
 * Pre-aggregated rank-bucket views (SPEC §6.1, reporting layer). Each rolls a wildcard `_all` view
 * up to one row per day × property × rank bucket, so a BI tool plots the ranking distribution
 * without scanning millions of query-grained rows on every interaction — which is what keeps a
 * rank-bucket heatmap instant in Looker Studio.
 *
 * `source` is the wildcard view they're derived from; they're (re)created whenever it is.
 * Device/country are deliberately dropped — carrying them would defeat the pre-aggregation. Query
 * the `_all` views directly when you need to slice by those.
 */
export const RANK_BUCKET_VIEWS: ReadonlyArray<{
  source: string;
  viewId: string;
  /** Extra entity dimension carried through the rollup; `null` = property-level daily distribution. */
  dim: 'page' | null;
}> = [
  { source: 'byProperty_all', viewId: 'rank_buckets_daily', dim: null },
  { source: 'byPage_all', viewId: 'rank_buckets_by_page', dim: 'page' },
];

/**
 * Roll a wildcard view up to day × property × [page ×] rank bucket. Every measure is query-grained,
 * so rows without a query (totals, Discover) are excluded rather than silently counted as rank 0.
 */
export function buildRankBucketViewSql(
  projectId: string,
  sourceViewId: string,
  dim: 'page' | null,
): string {
  const entity = dim ? `  ${dim},\n` : '';
  const group = ['data_date', 'source_table', 'search_type', 'data_state']
    .concat(dim ? [dim] : [])
    .concat(['rank_bucket', 'rank_bucket_index'])
    .join(', ');
  return `SELECT
  data_date,
  source_table,
  search_type,
  data_state,
${entity}  ${rankBucketCaseSql()} AS rank_bucket,
  ${rankBucketIndexCaseSql()} AS rank_bucket_index,
  COUNT(DISTINCT query) AS queries,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks
FROM \`${projectId}.${DATASETS.views}.${sourceViewId}\`
WHERE query IS NOT NULL
GROUP BY ${group}`;
}
