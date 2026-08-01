/**
 * Native Bulk Export adapter views (SPEC §12).
 *
 * Google Search Console can stream data straight into a user-owned BigQuery dataset ("Bulk Export").
 * That dataset has its own schema; ConsoleVault does NOT collect these properties via the API.
 * Instead, per native-export property we create two SQL **views** — one at
 * `gsc_byProperty.<sanitizedTableName>` and one at `gsc_byPage.<sanitizedTableName>` — that project
 * the native tables into ConsoleVault's shared {@link GSC_ROW_SCHEMA}. Because the whole reporting
 * layer resolves a property to `gsc_byProperty|byPage.<name>` (see `analytics.ts` fromTable/
 * fromUnion), every report, filter, rollup and opportunity then works with zero downstream changes.
 *
 * These builders are pure (unit-tested). The mapping is near 1:1 — native `search_type` values are
 * already ConsoleVault's (`web`…`googleNews`); position derives as `SUM(pos)/SUM(impressions) + 1`
 * (site table = `sum_top_position`, url table = `sum_position`, both 0-based). `totals`/anomaly is
 * an API-collection artefact and is intentionally not produced for native properties (SPEC §12).
 */

/** The native GSC Bulk Export table names (fixed by Google). */
export const NATIVE_EXPORT_TABLES = {
  /** By-property (site-wide) impressions → maps to ConsoleVault `byProperty`. */
  site: 'searchdata_site_impression',
  /** By-URL impressions → maps to ConsoleVault `byPage`. */
  url: 'searchdata_url_impression',
  /** Export audit log (per-day publish time / epoch version) → freshness. */
  log: 'ExportLog',
} as const;

/** GSC's default Bulk Export dataset name (user-customizable at export setup). */
export const DEFAULT_EXPORT_DATASET = 'searchconsole';

/** BigQuery-safe form of a location id for use in a dataset name (e.g. "australia-southeast1"). */
export function sanitizeRegion(location: string): string {
  return location.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

/**
 * Landing dataset (in ConsoleVault's project, in the export's region) that holds the adapter views
 * for cross-region native exports (SPEC §12). Same-region exports use gsc_byProperty/gsc_byPage
 * directly; only a location that differs from the deployment gets its own region-local dataset.
 */
export function nativeLandingDataset(location: string): string {
  return `gsc_native_${sanitizeRegion(location)}`;
}

/** byPage adapter-view name inside a native landing dataset (byProperty uses the plain name). */
export function nativePageViewName(sanitizedTableName: string): string {
  return `${sanitizedTableName}__page`;
}

/** Property type from a siteUrl, without depending on @consolevault/gsc (same rule as sanitize). */
export function nativePropertyType(siteUrl: string): 'url_prefix' | 'domain' {
  return siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix';
}

/** Escape a string for safe inlining as a BigQuery single-quoted literal (views can't take params). */
function sqlLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function tableRef(projectId: string, datasetId: string, tableId: string): string {
  return `\`${projectId}.${datasetId}.${tableId}\``;
}

/**
 * `row_hash` expression matching {@link rowHash} exactly: sha256 hex of the identity tuple joined
 * with `|`, every element coerced to a non-null string (mirrors `x ?? ''` / `String(bool)` in JS).
 */
function rowHashExpr(aggregation: 'byProperty' | 'byPage', anonymizedExpr: string): string {
  const page = aggregation === 'byPage' ? 'IFNULL(url, "")' : '""';
  return `TO_HEX(SHA256(ARRAY_TO_STRING([
      site_url,
      CAST(data_date AS STRING),
      search_type,
      '${aggregation}',
      IFNULL(query, ""),
      ${page},
      IFNULL(country, ""),
      IFNULL(device, ""),
      "",
      CAST(${anonymizedExpr} AS STRING)
    ], '|')))`;
}

/**
 * View SELECT mapping `searchdata_site_impression` → the `byProperty` shape for one property.
 * Filtered to a single `site_url` so it drops in at `gsc_byProperty.<sanitizedTableName>`.
 */
export function buildNativeByPropertyViewSql(
  projectId: string,
  exportDatasetId: string,
  siteUrl: string,
): string {
  const propertyType = nativePropertyType(siteUrl);
  return `SELECT
    data_date,
    site_url AS property,
    '${propertyType}' AS property_type,
    search_type,
    'byProperty' AS aggregation,
    NULLIF(query, '') AS query,
    CAST(NULL AS STRING) AS page,
    country,
    device,
    CAST(NULL AS STRING) AS search_appearance,
    clicks,
    impressions,
    SAFE_DIVIDE(clicks, impressions) AS ctr,
    SAFE_DIVIDE(sum_top_position, impressions) + 1 AS position,
    is_anonymized_query AS is_anonymized,
    ${rowHashExpr('byProperty', 'is_anonymized_query')} AS row_hash,
    CURRENT_TIMESTAMP() AS collected_at,
    'final' AS data_state
  FROM ${tableRef(projectId, exportDatasetId, NATIVE_EXPORT_TABLES.site)}
  WHERE site_url = ${sqlLiteral(siteUrl)}`;
}

/**
 * View SELECT mapping `searchdata_url_impression` → the `byPage` shape for one property. Adds
 * `url` → `page`, uses `sum_position` (the url table's column), and treats a row as anonymized if
 * either the query or the Discover row is anonymized.
 */
export function buildNativeByPageViewSql(
  projectId: string,
  exportDatasetId: string,
  siteUrl: string,
): string {
  const propertyType = nativePropertyType(siteUrl);
  return `SELECT
    data_date,
    site_url AS property,
    '${propertyType}' AS property_type,
    search_type,
    'byPage' AS aggregation,
    NULLIF(query, '') AS query,
    url AS page,
    country,
    device,
    CAST(NULL AS STRING) AS search_appearance,
    clicks,
    impressions,
    SAFE_DIVIDE(clicks, impressions) AS ctr,
    SAFE_DIVIDE(sum_position, impressions) + 1 AS position,
    (is_anonymized_query OR is_anonymized_discover) AS is_anonymized,
    ${rowHashExpr('byPage', '(is_anonymized_query OR is_anonymized_discover)')} AS row_hash,
    CURRENT_TIMESTAMP() AS collected_at,
    'final' AS data_state
  FROM ${tableRef(projectId, exportDatasetId, NATIVE_EXPORT_TABLES.url)}
  WHERE site_url = ${sqlLiteral(siteUrl)}`;
}

/** Distinct site_urls present in an export dataset — the property list for native discovery. */
export function distinctExportSiteUrlsSql(projectId: string, exportDatasetId: string): string {
  return `SELECT DISTINCT site_url
    FROM ${tableRef(projectId, exportDatasetId, NATIVE_EXPORT_TABLES.site)}
    ORDER BY site_url`;
}

/** Most recent successfully exported day (from ExportLog) — the freshness signal for the UI/Doctor. */
export function latestExportDateSql(projectId: string, exportDatasetId: string): string {
  return `SELECT MAX(data_date) AS latest FROM ${tableRef(
    projectId,
    exportDatasetId,
    NATIVE_EXPORT_TABLES.log,
  )}`;
}
