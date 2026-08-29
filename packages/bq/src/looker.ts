/**
 * Looker Studio template links (SPEC §10) — build the Linking API URL that opens a Looker Studio
 * report with THIS deployment's cross-property views already bound as data sources.
 *
 * A Looker Studio report is server-side state inside Google's product, not a file, so a repo can
 * never ship "the report" — only the binding. The Linking API is the supported mechanism for that:
 * `c.reportId` names a published template report to copy, and the `ds.<alias>.*` parameters repoint
 * each of its data sources at the user's own project before the copy is made. With no template id
 * configured the same URL still opens a fresh report with the views bound and typed, which is the
 * part every install gets without depending on anyone else's published report staying alive.
 *
 * https://developers.google.com/looker-studio/integrate/linking-api
 */

import { DATASETS } from './schema.js';

/** Linking API entry point. `datastudio.google.com/reporting/create` redirects here. */
export const LOOKER_CREATE_URL = 'https://lookerstudio.google.com/reporting/create';

/** Default name for the report the link creates. */
export const LOOKER_REPORT_NAME = 'ConsoleVault — Search Console';

/** A BigQuery data source bound by table reference — cheapest to configure, no SQL in the URL. */
export interface LookerTableSource {
  alias: string;
  name: string;
  type: 'TABLE';
  datasetId: string;
  tableId: string;
}

/** A BigQuery data source bound by SQL — used to scope a link to one client's properties. */
export interface LookerQuerySource {
  alias: string;
  name: string;
  type: 'CUSTOM_QUERY';
  sql: string;
}

export type LookerDatasource = LookerTableSource | LookerQuerySource;

/**
 * The three data sources a ConsoleVault report is built on — the self-maintaining wildcard views,
 * so a property added tomorrow shows up without touching the report (SPEC §6.1).
 *
 * The aliases are part of the contract with a published template report: Looker Studio matches
 * `ds.<alias>.*` against the template's data source aliases (Resource → Manage added data sources),
 * so a template that wants to be re-pointable by this link must alias its sources `queries`,
 * `pages` and `totals`. They are stable and must not be renamed.
 */
export const LOOKER_TEMPLATE_VIEWS: ReadonlyArray<{
  alias: string;
  name: string;
  viewId: string;
  grain: string;
}> = [
  {
    alias: 'queries',
    name: 'ConsoleVault — queries',
    viewId: 'byProperty_all',
    grain: 'query × country × device × day, every property',
  },
  {
    alias: 'pages',
    name: 'ConsoleVault — pages',
    viewId: 'byPage_all',
    grain: 'page × country × device × day, every property',
  },
  {
    alias: 'totals',
    name: 'ConsoleVault — totals',
    viewId: 'totals_all',
    grain: 'daily totals (the anonymized-query baseline), every property',
  },
];

/**
 * Calculated fields the report needs, defined once here so the docs and the UI can't drift apart.
 *
 * The first two exist because `ctr` and `position` are RATIOS: a BI tool aggregating a rank
 * distribution by averaging its own averages produces a number that belongs to no property, no
 * query and no day. Re-deriving both from the summable columns is the only correct way to roll them
 * up, and it holds at every level of the report — one query, one property, or the whole agency.
 */
export const LOOKER_CALCULATED_FIELDS: ReadonlyArray<{
  name: string;
  formula: string;
  note: string;
}> = [
  {
    name: 'Avg position',
    formula: 'SUM(position * impressions) / SUM(impressions)',
    note: 'Impression-weighted. Never AVG(position) — that averages averages.',
  },
  {
    name: 'CTR',
    formula: 'SUM(clicks) / SUM(impressions)',
    note: 'Re-derived from the totals. Never AVG(ctr). Format as percent.',
  },
  {
    name: 'Top 10 impressions',
    formula: 'SUM(IF(position < 11, impressions, 0))',
    note: 'Share of demand that actually reached page one, without the average hiding the shape.',
  },
];

/** BigQuery identifiers this module will interpolate into SQL. Anything else is rejected. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

/**
 * Guard the only user-derived values that reach the generated SQL. Property table names are
 * produced by `sanitizeTableName` and are always `[A-Za-z0-9_]+`, so a value that fails this is a
 * bug or an injection attempt, never a legitimate property — refuse rather than quote around it.
 */
function assertSafeIdentifiers(names: readonly string[]): void {
  for (const n of names) {
    if (!SAFE_IDENTIFIER.test(n)) throw new Error(`unsafe BigQuery identifier: ${n}`);
  }
}

/**
 * Bounded SELECT over one wildcard view, scoped to a set of property tables.
 *
 * Two deliberate bounds: `data_date` is limited to the deployment's backfill window so a report a
 * client leaves open on a Monday can't scan 16 months per chart, and the window is measured in
 * Pacific Time because that is what GSC's own day boundaries mean (CLAUDE.md hard rule 7). The
 * bookkeeping columns are dropped — `row_hash` and `collected_at` are ingestion internals that only
 * add field-picker noise in a BI tool.
 */
export function buildScopedViewSql(
  projectId: string,
  viewId: string,
  sourceTables: readonly string[],
  months: number,
): string {
  assertSafeIdentifiers(sourceTables);
  const window = Math.max(1, Math.floor(months));
  const inList = sourceTables.map((t) => `'${t}'`).join(', ');
  return [
    'SELECT * EXCEPT (row_hash, collected_at)',
    `FROM \`${projectId}.${DATASETS.views}.${viewId}\``,
    `WHERE data_date >= DATE_SUB(CURRENT_DATE('America/Los_Angeles'), INTERVAL ${window} MONTH)`,
    `  AND source_table IN (${inList})`,
  ].join('\n');
}

/**
 * The data sources for a template link. With no `sourceTables` the report is agency-wide and binds
 * the views directly (TABLE), which keeps the URL short and lets the reader filter on
 * `source_table` themselves. Given `sourceTables`, the scope is baked into SQL instead
 * (CUSTOM_QUERY) — a link handed to one client must not be one filter-click away from another
 * client's data.
 */
export function buildTemplateDatasources(
  projectId: string,
  opts: { sourceTables?: readonly string[]; months?: number } = {},
): LookerDatasource[] {
  const { sourceTables, months = 16 } = opts;
  return LOOKER_TEMPLATE_VIEWS.map((v) =>
    sourceTables && sourceTables.length > 0
      ? {
          alias: v.alias,
          name: v.name,
          type: 'CUSTOM_QUERY' as const,
          sql: buildScopedViewSql(projectId, v.viewId, sourceTables, months),
        }
      : {
          alias: v.alias,
          name: v.name,
          type: 'TABLE' as const,
          datasetId: DATASETS.views,
          tableId: v.viewId,
        },
  );
}

/** One data source's `ds.<alias>.*` parameters, in Linking API form. */
function datasourceParams(
  ds: LookerDatasource,
  projectId: string,
  billingProjectId: string,
): Array<[string, string]> {
  const p = `ds.${ds.alias}`;
  const common: Array<[string, string]> = [
    [`${p}.connector`, 'bigQuery'],
    [`${p}.datasourceName`, ds.name],
    [`${p}.type`, ds.type],
    [`${p}.billingProjectId`, billingProjectId],
  ];
  return ds.type === 'TABLE'
    ? [
        ...common,
        [`${p}.projectId`, projectId],
        [`${p}.datasetId`, ds.datasetId],
        [`${p}.tableId`, ds.tableId],
      ]
    : [...common, [`${p}.sql`, ds.sql]];
}

/**
 * Build the Linking API URL. `templateReportId` copies a published report and repoints its data
 * sources; without it Looker Studio opens a blank report with the same sources bound, so the link
 * is useful on a fresh install that has no template of its own.
 */
export function buildLookerTemplateUrl(opts: {
  projectId: string;
  datasources: readonly LookerDatasource[];
  /** Project billed for the queries the report runs. Defaults to the deployment's own project. */
  billingProjectId?: string;
  reportName?: string;
  templateReportId?: string;
}): string {
  const { projectId, datasources, billingProjectId = projectId } = opts;
  const params: Array<[string, string]> = [];
  if (opts.templateReportId) params.push(['c.reportId', opts.templateReportId]);
  params.push(['r.reportName', opts.reportName ?? LOOKER_REPORT_NAME]);
  for (const ds of datasources) {
    params.push(...datasourceParams(ds, projectId, billingProjectId));
  }
  const qs = params
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${LOOKER_CREATE_URL}?${qs}`;
}
