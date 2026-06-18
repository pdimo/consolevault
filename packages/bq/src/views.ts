/**
 * Property-group union view SQL (SPEC §6.4). Combining isn't SUM: clicks/impressions add, but CTR
 * and position must be re-weighted (impression-weighted), encoded once here.
 */

import { DATASETS } from './schema.js';

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
