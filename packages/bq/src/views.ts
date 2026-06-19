/**
 * Property-group union view SQL (SPEC §6.4). Combining isn't SUM: clicks/impressions add, but CTR
 * and position must be re-weighted (impression-weighted), encoded once here.
 */

import { DATASETS } from './schema.js';

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

export function buildWildcardViewSql(projectId: string, dataset: string): string {
  return `SELECT *, _TABLE_SUFFIX AS source_table FROM \`${projectId}.${dataset}.*\``;
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
