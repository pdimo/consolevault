/**
 * Analytics SQL builders for the Dashboards feature. Pure + parameterized (unit-tested): a target
 * resolves to a FROM operand (a per-property table or a UNION over a group's member tables) and a
 * `DashboardFilters` compiles to a parameterized WHERE clause. The Warehouse runs these with a hard
 * `maximumBytesBilled` cap (cost safety valve). Metrics are impression-weighted where appropriate.
 */

import type { DashboardFilters, MatchRule } from '@consolevault/types';

export type Rollup = 'day' | 'week' | 'month';

/**
 * Build a boolean SQL expression that is true when a row matches ANY of a semantic group's rules
 * (content groups → `page`, topic clusters → `query`), registering the params. Case-insensitive.
 * Returns '' (no-op) when there are no usable rules.
 */
export function groupMatchExpr(
  rules: MatchRule[],
  params: Record<string, unknown>,
  prefix = 'g',
): string {
  const parts: string[] = [];
  rules.forEach((r, i) => {
    const v = r.value.trim();
    if (!v) return;
    const p = `${prefix}${i}`;
    const col = r.dimension === 'page' ? 'page' : 'query';
    if (r.op === 'regex') {
      params[p] = v;
      parts.push(`REGEXP_CONTAINS(LOWER(${col}), @${p})`);
    } else if (r.op === 'equals') {
      params[p] = v.toLowerCase();
      parts.push(`LOWER(${col}) = @${p}`);
    } else if (r.op === 'starts_with') {
      params[p] = `${v.toLowerCase()}%`;
      parts.push(`LOWER(${col}) LIKE @${p}`);
    } else {
      params[p] = `%${v.toLowerCase()}%`;
      parts.push(`LOWER(${col}) LIKE @${p}`);
    }
  });
  return parts.length ? `(${parts.join(' OR ')})` : '';
}

export type CompareMode = NonNullable<DashboardFilters['compareMode']>;

/** Add `n` days to a YYYY-MM-DD date string (UTC arithmetic — safe for date-only math). */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD date by `n` calendar months, clamping to the target month's last day. */
function shiftMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const year = first.getUTCFullYear();
  const month = first.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Resolve the comparison window for period-over-period reports. Returns `null` when there is no
 * comparison (mode 'none', or a 'custom' mode missing its explicit dates). Modes:
 * - previous  → the same-length window immediately preceding [start,end] (default; legacy behaviour)
 * - yoy       → one year earlier; matchWeekdays shifts 364d (same weekday) instead of 365d
 * - prev_month→ both endpoints shifted back one calendar month (EOM-clamped)
 * - custom    → the explicit compareStart/compareEnd
 */
export function comparisonWindow(
  f: Pick<
    DashboardFilters,
    'start' | 'end' | 'compareMode' | 'compareStart' | 'compareEnd' | 'matchWeekdays'
  >,
): { start: string; end: string } | null {
  const mode: CompareMode = f.compareMode ?? 'previous';
  if (mode === 'none') return null;
  if (mode === 'custom') {
    return f.compareStart && f.compareEnd ? { start: f.compareStart, end: f.compareEnd } : null;
  }
  if (mode === 'yoy') {
    const shift = f.matchWeekdays ? 364 : 365;
    return { start: addDays(f.start, -shift), end: addDays(f.end, -shift) };
  }
  if (mode === 'prev_month') {
    return { start: shiftMonths(f.start, -1), end: shiftMonths(f.end, -1) };
  }
  const days = Math.round((Date.parse(f.end) - Date.parse(f.start)) / 86_400_000);
  const prevEnd = addDays(f.start, -1);
  return { start: addDays(prevEnd, -days), end: prevEnd };
}

/** FROM operand for a single property table. */
export function fromTable(projectId: string, dataset: string, table: string): string {
  return `\`${projectId}.${dataset}.${table}\``;
}

/** FROM operand unioning a group's member tables in one dataset. */
export function fromUnion(projectId: string, dataset: string, tables: string[]): string {
  return `(${tables.map((t) => `SELECT * FROM \`${projectId}.${dataset}.${t}\``).join(' UNION ALL ')})`;
}

export interface CompiledFilters {
  where: string;
  params: Record<string, unknown>;
}

function splitTerms(s: string | undefined): string[] {
  return (s ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Compile filters → a parameterized WHERE clause. Always constrains search_type + the date range
 * (partition prune). Optional: device/country IN, query/page "contains" (comma lists, OR'd),
 * position range, brand-exclude (NOT LIKE), final-only. `requireQuery`/`requirePage` add NOT NULL
 * guards for grouped reports.
 */
export function compileFilters(
  f: DashboardFilters,
  opts: { requireQuery?: boolean; requirePage?: boolean } = {},
): CompiledFilters {
  const clauses: string[] = ['search_type = @searchType', 'data_date BETWEEN @start AND @end'];
  const params: Record<string, unknown> = {
    searchType: f.searchType ?? 'web',
    start: f.start,
    end: f.end,
  };
  if (f.finalOnly) clauses.push("data_state = 'final'");
  if (f.device?.length) {
    clauses.push('device IN UNNEST(@device)');
    params.device = f.device;
  }
  if (f.country?.length) {
    clauses.push('country IN UNNEST(@country)');
    params.country = f.country;
  }
  if (f.positionMin != null) {
    clauses.push('position >= @posMin');
    params.posMin = f.positionMin;
  }
  if (f.positionMax != null) {
    clauses.push('position <= @posMax');
    params.posMax = f.positionMax;
  }
  const qTerms = splitTerms(f.query);
  if (qTerms.length) {
    clauses.push(`(${qTerms.map((_, i) => `LOWER(query) LIKE @q${i}`).join(' OR ')})`);
    qTerms.forEach((t, i) => (params[`q${i}`] = `%${t.toLowerCase()}%`));
  }
  const pTerms = splitTerms(f.page);
  if (pTerms.length) {
    clauses.push(`(${pTerms.map((_, i) => `LOWER(page) LIKE @p${i}`).join(' OR ')})`);
    pTerms.forEach((t, i) => (params[`p${i}`] = `%${t.toLowerCase()}%`));
  }
  (f.brandExclude ?? []).forEach((t, i) => {
    clauses.push(`LOWER(query) NOT LIKE @b${i}`);
    params[`b${i}`] = `%${t.toLowerCase()}%`;
  });
  // Brand segment (query-time classification). `nonbrand` also excludes null-query rows since they
  // can't be classified. No-op when the target has no brand terms.
  const brandTerms = (f.brandTerms ?? []).map((t) => t.trim()).filter(Boolean);
  if (f.segment && brandTerms.length) {
    const expr = brandMatchExpr(brandTerms, params);
    clauses.push(f.segment === 'brand' ? expr : `(query IS NOT NULL AND NOT ${expr})`);
  }
  // Preset filters (each AND-applied). Both are query-shaped, so they imply a non-null query.
  for (const preset of f.presets ?? []) {
    if (preset === 'paa') {
      clauses.push(
        String.raw`REGEXP_CONTAINS(LOWER(query), r'^(who|what|when|where|why|how|is|are|can|could|does|do|did|will|would|should|which)\b')`,
      );
    } else if (preset === 'longtail') {
      clauses.push('ARRAY_LENGTH(SPLIT(TRIM(query), " ")) >= 4');
    }
  }
  if (opts.requireQuery) clauses.push('query IS NOT NULL');
  if (opts.requirePage) clauses.push('page IS NOT NULL');
  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

/**
 * Build a boolean SQL expression that is true when `query` contains any brand term (case-insensitive),
 * registering the LIKE params. Shared by the segment filter and the brand split. Returns '' (no-op)
 * when there are no terms.
 */
export function brandMatchExpr(terms: string[], params: Record<string, unknown>): string {
  const t = terms.map((s) => s.trim()).filter(Boolean);
  if (!t.length) return '';
  return `(${t
    .map((term, i) => {
      params[`bt${i}`] = `%${term.toLowerCase()}%`;
      return `LOWER(query) LIKE @bt${i}`;
    })
    .join(' OR ')})`;
}

/** Brand vs non-brand split: two rows (segment = brand|nonbrand) with the standard metrics. */
export function brandSplitSql(from: string, where: string, brandExpr: string): string {
  return `SELECT IF(${brandExpr}, 'brand', 'nonbrand') AS segment,${METRICS}
FROM ${from} ${where} AND query IS NOT NULL
GROUP BY segment`;
}

/** Brand vs non-brand clicks over time (for a stacked brand-share trend). */
export function brandTimeseriesSql(
  from: string,
  where: string,
  brandExpr: string,
  rollup: Rollup = 'day',
): string {
  const bucket =
    rollup === 'week'
      ? 'DATE_TRUNC(data_date, WEEK(MONDAY))'
      : rollup === 'month'
        ? 'DATE_TRUNC(data_date, MONTH)'
        : 'data_date';
  return `SELECT FORMAT_DATE('%Y-%m-%d', ${bucket}) AS date,
  SUM(IF(${brandExpr}, clicks, 0)) AS brand,
  SUM(IF(NOT ${brandExpr}, clicks, 0)) AS nonbrand,
  SUM(IF(${brandExpr}, impressions, 0)) AS brandImpr,
  SUM(IF(NOT ${brandExpr}, impressions, 0)) AS nonbrandImpr
FROM ${from} ${where} AND query IS NOT NULL
GROUP BY date
ORDER BY date`;
}

const METRICS = `
  SUM(clicks) AS clicks,
  SUM(impressions) AS impressions,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) AS position`;

/** Headline totals (impression-weighted CTR + position). */
export function kpisSql(from: string, where: string): string {
  return `SELECT${METRICS}\nFROM ${from} ${where}`;
}

/**
 * One row of per-group summed metrics: for each group boolean `expr`, `SUM(IF(expr, metric, 0))`.
 * Computes N groups' clicks/impressions/(weighted) CTR/position in a single scan. Aliases are
 * `g{i}_clicks|_impr|_ctr|_pos`. Callers must pass ≥1 expr (use 'FALSE' for an empty group).
 */
export function groupedMetricsSql(from: string, where: string, exprs: string[]): string {
  const cols = exprs
    .map(
      (e, i) => `SUM(IF(${e}, clicks, 0)) AS g${i}_clicks,
  SUM(IF(${e}, impressions, 0)) AS g${i}_impr,
  SAFE_DIVIDE(SUM(IF(${e}, clicks, 0)), SUM(IF(${e}, impressions, 0))) AS g${i}_ctr,
  SAFE_DIVIDE(SUM(IF(${e}, position * impressions, 0)), SUM(IF(${e}, impressions, 0))) AS g${i}_pos`,
    )
    .join(',\n  ');
  return `SELECT ${cols}\nFROM ${from} ${where}`;
}

/** Time series, optionally rolled up to week/month. */
export function timeseriesSql(from: string, where: string, rollup: Rollup = 'day'): string {
  const bucket =
    rollup === 'week'
      ? 'DATE_TRUNC(data_date, WEEK(MONDAY))'
      : rollup === 'month'
        ? 'DATE_TRUNC(data_date, MONTH)'
        : 'data_date';
  return `SELECT
  FORMAT_DATE('%Y-%m-%d', ${bucket}) AS date,${METRICS}
FROM ${from} ${where}
GROUP BY date
ORDER BY date`;
}

/** Top queries or pages by clicks (bypasses GSC's 1,000-row UI limit). */
export function topEntitySql(
  from: string,
  where: string,
  dim: 'query' | 'page',
  limit = 100,
): string {
  return `SELECT ${dim} AS key,${METRICS}
FROM ${from} ${where}
GROUP BY key
ORDER BY clicks DESC, impressions DESC
LIMIT ${Math.min(Math.max(limit, 1), 5000)}`;
}

/** Breakdown by a single dimension (device | country). */
export function breakdownSql(from: string, where: string, dim: 'device' | 'country'): string {
  return `SELECT ${dim} AS key,${METRICS}
FROM ${from} ${where}
GROUP BY key
ORDER BY clicks DESC, impressions DESC`;
}

/** Impressions per ranking tier per day (stacked-area ranking-segment view). */
export function positionBucketsSql(from: string, where: string): string {
  return `SELECT FORMAT_DATE('%Y-%m-%d', data_date) AS date,
  SUM(IF(position <= 3, impressions, 0)) AS top3,
  SUM(IF(position > 3 AND position <= 10, impressions, 0)) AS p4_10,
  SUM(IF(position > 10 AND position <= 20, impressions, 0)) AS p11_20,
  SUM(IF(position > 20 AND position <= 50, impressions, 0)) AS p21_50,
  SUM(IF(position > 50, impressions, 0)) AS p50plus
FROM ${from} ${where}
GROUP BY date
ORDER BY date`;
}

/** Per-query weighted position + ctr + impressions for the CTR-vs-position scatter. */
export function ctrScatterSql(from: string, where: string, limit = 500): string {
  return `SELECT query AS key,
  SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) AS position,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks
FROM ${from} ${where}
GROUP BY key
HAVING impressions > 0
ORDER BY impressions DESC
LIMIT ${Math.min(Math.max(limit, 1), 2000)}`;
}

/** Site CTR benchmark curve: impression-weighted CTR by integer position (1–10). */
export function ctrCurveSql(from: string, where: string): string {
  return `SELECT CAST(ROUND(position) AS INT64) AS pos,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SUM(impressions) AS impressions
FROM ${from} ${where}
GROUP BY pos
HAVING pos BETWEEN 1 AND 10
ORDER BY pos`;
}

/** Per-query CTR vs its position (weighted ≤10), for benchmarking against the site curve. */
export function ctrBenchmarkSql(from: string, where: string, limit = 200): string {
  return `SELECT query AS key,
  SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) AS position,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks
FROM ${from} ${where}
GROUP BY key
HAVING position <= 10 AND impressions > 0
ORDER BY impressions DESC
LIMIT ${Math.min(Math.max(limit, 1), 1000)}`;
}

/** (query, page) pairs by impressions — the raw input for cannibalization detection (grouped in JS). */
export function queryPagePairsSql(from: string, where: string, limit = 5000): string {
  return `SELECT query AS q, page AS p,
  SUM(clicks) AS clicks,
  SUM(impressions) AS impressions,
  SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) AS position
FROM ${from} ${where}
GROUP BY q, p
ORDER BY impressions DESC
LIMIT ${Math.min(Math.max(limit, 1), 20000)}`;
}

/**
 * Striking-distance: queries whose weighted position falls in [min,max] (default 11–20, "page-2
 * wins"), ordered by impressions. Bounds are clamped integers (safe to inline).
 */
export function strikingDistanceSql(
  from: string,
  where: string,
  opts: { min?: number; max?: number; limit?: number } = {},
): string {
  const clampPos = (v: number, d: number) => Math.min(Math.max(Math.round(v || d), 1), 1000);
  const min = clampPos(opts.min ?? 11, 11);
  const max = clampPos(opts.max ?? 20, 20);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  return `SELECT query AS key,
  SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) AS position,
  SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr,
  SUM(impressions) AS impressions,
  SUM(clicks) AS clicks
FROM ${from} ${where}
GROUP BY key
HAVING position >= ${min} AND position <= ${max}
ORDER BY impressions DESC
LIMIT ${limit}`;
}
