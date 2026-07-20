/**
 * BigQuery + GCS write helpers (the warehouse-access layer).
 *
 * Idempotency (SPEC §6.3, §9): a task always collects one whole `(property, type, agg, day)`, so
 * the day×type is the atomic unit. We DELETE that precise slice then LOAD-append the freshly
 * collected rows — re-running replaces, never appends. This is also the restatement mechanism.
 */

import { BigQuery } from '@google-cloud/bigquery';
import type { TableMetadata } from '@google-cloud/bigquery';
import { Storage } from '@google-cloud/storage';
import { DATASETS, GSC_ROW_SCHEMA, type BqField } from './schema.js';
import { buildWildcardViewSql, WILDCARD_VIEWS } from './views.js';

export interface WarehouseConfig {
  projectId: string;
  /** BigQuery location (bq_location, e.g. "US"). */
  location: string;
  stagingBucket: string;
}

/** One append-only task attempt row (mirrors TASK_LOGS_SCHEMA). */
export interface TaskLogRow {
  task_id: string;
  property: string;
  search_type: string;
  aggregation: string;
  data_date: string;
  account_id?: string;
  status: string;
  attempt: number;
  row_count?: number;
  api_calls?: number;
  error_message?: string;
  logged_at: string;
}

interface EnsureTableOptions {
  partitionField?: string;
  clustering?: string[];
}

function toBigQuerySchema(fields: readonly BqField[]): { fields: BqField[] } {
  return { fields: fields.map((f) => ({ ...f })) };
}

/** BigQuery error `reason`s that clear on their own — safe to retry after a backoff. */
const RETRIABLE_BQ_REASONS = new Set([
  'rateLimitExceeded',
  'quotaExceeded',
  'jobRateLimitExceeded',
  'backendError',
  'internalError',
]);

/**
 * True for the transient rate/quota/backend errors a heavy backfill provokes — notably the DML
 * "exceeded quota for total number of dml jobs writing to a table, pending + running" and
 * "table dml insert operations" limits, which are per-table concurrency ceilings that drain as
 * in-flight DML clears (confirmed live on the 2026-06-19/20 backfill). Genuine daily-hard quotas
 * also match here but are bounded by `maxAttempts`, so we simply fail slightly later, never loop.
 */
export function isRetriableBqError(err: unknown): boolean {
  const e = err as { code?: number; message?: string; errors?: Array<{ reason?: string }> };
  if (e?.errors?.some((x) => x.reason != null && RETRIABLE_BQ_REASONS.has(x.reason))) return true;
  if (e?.code === 500 || e?.code === 503) return true;
  // Some rate/quota errors carry the signal only in the message text, not a structured reason.
  const msg = (e?.message ?? '').toLowerCase();
  return msg.includes('exceeded quota') || msg.includes('exceeded rate limits');
}

export interface BqRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests so they don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests to make backoff deterministic. */
  random?: () => number;
}

/**
 * Run `op`, retrying retriable BigQuery errors with exponential backoff + full jitter. Full jitter
 * (delay ∈ [0, cap]) de-synchronizes the fan-out of concurrent collectors racing the same table,
 * which is exactly what causes the "pending + running" DML ceiling in the first place.
 */
export async function withBqRetry<T>(op: () => Promise<T>, opts: BqRetryOptions = {}): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 6;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  const maxDelayMs = opts.maxDelayMs ?? 16000;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (err) {
      if (attempt >= maxAttempts || !isRetriableBqError(err)) throw err;
      const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(Math.floor(random() * cap));
    }
  }
}

export class Warehouse {
  private readonly bq: BigQuery;
  private readonly storage: Storage;

  constructor(private readonly cfg: WarehouseConfig) {
    this.bq = new BigQuery({ projectId: cfg.projectId, location: cfg.location });
    this.storage = new Storage({ projectId: cfg.projectId });
  }

  private tableRef(datasetId: string, tableId: string): string {
    return `\`${this.cfg.projectId}.${datasetId}.${tableId}\``;
  }

  /**
   * Per-dataset storage rollup (table count, rows, logical bytes) from each dataset's __TABLES__
   * meta-table. Cheap metadata scan — drives the Costs panel's storage estimate (SPEC §11), works
   * with no billing export configured.
   */
  async storageSummary(): Promise<
    Array<{ dataset: string; tables: number; rows: number; bytes: number }>
  > {
    const datasets = [DATASETS.byProperty, DATASETS.byPage, DATASETS.totals, DATASETS.taskLogs];
    const out: Array<{ dataset: string; tables: number; rows: number; bytes: number }> = [];
    for (const ds of datasets) {
      const [result] = await this.bq.query({
        // `rows` is a reserved keyword in BigQuery — use non-reserved output aliases.
        query: `SELECT COUNT(*) AS n_tables, IFNULL(SUM(row_count), 0) AS n_rows, IFNULL(SUM(size_bytes), 0) AS n_bytes FROM ${this.tableRef(ds, '__TABLES__')}`,
        location: this.cfg.location,
      });
      const r = (result[0] ?? {}) as { n_tables?: number; n_rows?: number; n_bytes?: number };
      out.push({
        dataset: ds,
        tables: Number(r.n_tables ?? 0),
        rows: Number(r.n_rows ?? 0),
        bytes: Number(r.n_bytes ?? 0),
      });
    }
    return out;
  }

  /**
   * Per-account GSC API usage from task_logs (Quota dashboard, Stage 6): calls today + over 7 days,
   * with Pacific-Time day boundaries. `api_calls` is NULL on pre-Stage-6 rows → counted as 0, so
   * usage accrues from when this ships. Returns empty if the log table doesn't exist yet.
   */
  async apiUsage(): Promise<{
    todayTotal: number;
    last7dTotal: number;
    byAccount: Array<{
      accountId: string | null;
      callsToday: number;
      calls7d: number;
      tasksToday: number;
    }>;
  }> {
    if (!(await this.tableExists(DATASETS.taskLogs, 'attempts'))) {
      return { todayTotal: 0, last7dTotal: 0, byAccount: [] };
    }
    const [rows] = await this.bq.query({
      query: `SELECT account_id,
          SUM(IF(DATE(logged_at, 'America/Los_Angeles') = CURRENT_DATE('America/Los_Angeles'), IFNULL(api_calls, 0), 0)) AS calls_today,
          SUM(IFNULL(api_calls, 0)) AS calls_7d,
          COUNT(DISTINCT IF(DATE(logged_at, 'America/Los_Angeles') = CURRENT_DATE('America/Los_Angeles'), task_id, NULL)) AS tasks_today
        FROM ${this.tableRef(DATASETS.taskLogs, 'attempts')}
        WHERE logged_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        GROUP BY account_id`,
      location: this.cfg.location,
    });
    const byAccount = (rows as Array<Record<string, unknown>>).map((r) => ({
      accountId: (r.account_id as string | null) ?? null,
      callsToday: Number(r.calls_today ?? 0),
      calls7d: Number(r.calls_7d ?? 0),
      tasksToday: Number(r.tasks_today ?? 0),
    }));
    return {
      todayTotal: byAccount.reduce((s, a) => s + a.callsToday, 0),
      last7dTotal: byAccount.reduce((s, a) => s + a.calls7d, 0),
      byAccount,
    };
  }

  /**
   * Run a parameterized analytics query for the Dashboards feature with a hard `maximumBytesBilled`
   * cap (cost safety valve) — a runaway query errors instead of billing. Read-only.
   */
  async runAnalytics(
    query: string,
    params: Record<string, unknown>,
    maxGiB = 2,
  ): Promise<Array<Record<string, unknown>>> {
    const [rows] = await this.bq.query({
      query,
      params,
      location: this.cfg.location,
      maximumBytesBilled: String(Math.round(maxGiB * 1024 ** 3)),
    });
    return rows as Array<Record<string, unknown>>;
  }

  /**
   * Daily collection activity for the last `days` (Overview chart, Stage 7): tasks + rows per
   * Pacific-Time day from task_logs. Returns [] if the log table doesn't exist yet.
   */
  async collectionActivity(
    days = 14,
  ): Promise<Array<{ date: string; tasks: number; rows: number }>> {
    if (!(await this.tableExists(DATASETS.taskLogs, 'attempts'))) return [];
    const [rows] = await this.bq.query({
      query: `SELECT FORMAT_DATE('%Y-%m-%d', DATE(logged_at, 'America/Los_Angeles')) AS day,
          COUNT(DISTINCT task_id) AS tasks, IFNULL(SUM(row_count), 0) AS n_rows
        FROM ${this.tableRef(DATASETS.taskLogs, 'attempts')}
        WHERE logged_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL ${days} DAY)
        GROUP BY day ORDER BY day`,
      location: this.cfg.location,
    });
    return (rows as Array<Record<string, unknown>>).map((r) => ({
      date: String(r.day),
      tasks: Number(r.tasks ?? 0),
      rows: Number(r.n_rows ?? 0),
    }));
  }

  /**
   * Real recent spend from a Cloud Billing export dataset (SPEC §11, opt-in). Sums the standard
   * `gcp_billing_export_v1_*` table over the last 30 days, by service. Returns null if the export
   * isn't set up (dataset/table missing) so the Costs panel falls back to the storage estimate.
   */
  async billingSpend(datasetId: string): Promise<{
    currency: string;
    total: number;
    byService: Array<{ service: string; cost: number }>;
  } | null> {
    try {
      const [rows] = await this.bq.query({
        query: `SELECT service.description AS service, currency, SUM(cost) AS cost
          FROM \`${this.cfg.projectId}.${datasetId}.gcp_billing_export_v1_*\`
          WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
          GROUP BY service, currency
          ORDER BY cost DESC`,
        location: this.cfg.location,
      });
      const list = rows as Array<{ service?: string; currency?: string; cost?: number }>;
      if (list.length === 0) return null;
      const byService = list.map((r) => ({
        service: r.service ?? 'unknown',
        cost: Number(Number(r.cost ?? 0).toFixed(2)),
      }));
      return {
        currency: list[0]?.currency ?? 'USD',
        total: Number(byService.reduce((s, r) => s + r.cost, 0).toFixed(2)),
        byService,
      };
    } catch {
      return null; // export not configured / table absent
    }
  }

  /**
   * Detect the Cloud Billing export setup state for the Costs page's guided opt-in. The dataset is
   * always provisioned, so a failing wildcard query means the user hasn't pointed the Console export
   * at it yet (no `gcp_billing_export_v1_*` table). `dataFlowing` is true once Google has written rows.
   */
  async billingExportStatus(datasetId: string): Promise<{
    exportConfigured: boolean;
    dataFlowing: boolean;
    lastDataDate: string | null;
  }> {
    try {
      const [rows] = await this.bq.query({
        query: `SELECT COUNT(*) AS n,
          FORMAT_DATE('%Y-%m-%d', MAX(DATE(usage_start_time))) AS last
          FROM \`${this.cfg.projectId}.${datasetId}.gcp_billing_export_v1_*\`
          WHERE usage_start_time >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 45 DAY)`,
        location: this.cfg.location,
      });
      const r = (rows as Array<{ n?: number; last?: string | null }>)[0];
      const n = Number(r?.n ?? 0);
      return { exportConfigured: true, dataFlowing: n > 0, lastDataDate: r?.last ?? null };
    } catch {
      return { exportConfigured: false, dataFlowing: false, lastDataDate: null };
    }
  }

  /**
   * Create a table (idempotently) — DATE-partitioned + clustered when requested. Returns true if it
   * actually created the table (false if it already existed), so callers can do one-time setup
   * (e.g. wildcard-view creation) only on a property's first-ever table.
   */
  async ensureTable(
    datasetId: string,
    tableId: string,
    fields: readonly BqField[],
    opts: EnsureTableOptions = {},
  ): Promise<boolean> {
    const table = this.bq.dataset(datasetId).table(tableId);
    const [exists] = await table.exists();
    if (exists) {
      await this.reconcileColumns(datasetId, tableId, fields);
      return false;
    }
    const metadata: TableMetadata = { schema: toBigQuerySchema(fields) };
    if (opts.partitionField) {
      metadata.timePartitioning = { type: 'DAY', field: opts.partitionField };
    }
    if (opts.clustering?.length) {
      metadata.clustering = { fields: opts.clustering };
    }
    try {
      await this.bq.dataset(datasetId).createTable(tableId, metadata);
      return true;
    } catch (err) {
      // Concurrent collectors for the same property race check-then-create; the loser sees
      // ALREADY_EXISTS (409). The table now exists either way, so treat it as success.
      if ((err as { code?: number }).code !== 409) throw err;
      return false;
    }
  }

  // Self-healing schema evolution: when a code release adds a NULLABLE column to a schema, add it to
  // any pre-existing table so inserts don't fail on upgraded installs. Once per table per process
  // (in-memory guard), best-effort (a concurrent reconcile that loses the race is harmless).
  private readonly reconciled = new Set<string>();
  private async reconcileColumns(
    datasetId: string,
    tableId: string,
    fields: readonly BqField[],
  ): Promise<void> {
    const key = `${datasetId}.${tableId}`;
    if (this.reconciled.has(key)) return;
    this.reconciled.add(key);
    try {
      const table = this.bq.dataset(datasetId).table(tableId);
      const [meta] = await table.getMetadata();
      const have = new Set((meta.schema?.fields ?? []).map((f: { name: string }) => f.name));
      const missing = fields.filter((f) => !have.has(f.name));
      if (missing.length === 0) return;
      meta.schema.fields = [
        ...(meta.schema.fields ?? []),
        // Added columns must be NULLABLE/REPEATED in BigQuery; force NULLABLE for safety.
        ...missing.map((f) => ({ name: f.name, type: f.type, mode: 'NULLABLE' })),
      ];
      await table.setMetadata({ schema: meta.schema });
    } catch {
      this.reconciled.delete(key); // let a later attempt retry
    }
  }

  /**
   * Ensure the wildcard view for a data dataset exists (SPEC §6.1). Wildcard views (`dataset.*`)
   * are DYNAMIC — once created they auto-include every future property table — so this is a cheap
   * create-if-missing, called only when a property's first table is created.
   */
  async ensureWildcardView(dataset: string, viewId: string): Promise<void> {
    if (await this.tableExists(DATASETS.views, viewId)) return;
    await this.createOrReplaceView(viewId, buildWildcardViewSql(this.cfg.projectId, dataset));
  }

  /** (Re)create all wildcard views over datasets that have ≥1 table. Used for initial/manual refresh. */
  async refreshWildcardViews(): Promise<string[]> {
    const created: string[] = [];
    for (const { dataset, viewId } of WILDCARD_VIEWS) {
      const [tables] = await this.bq.dataset(dataset).getTables();
      if (!tables.some((t) => t.id && !t.id.startsWith('_'))) continue;
      await this.createOrReplaceView(viewId, buildWildcardViewSql(this.cfg.projectId, dataset));
      created.push(viewId);
    }
    return created;
  }

  /** Write rows as NDJSON to the staging bucket; returns the object path. */
  async uploadNdjson(objectPath: string, rows: readonly object[]): Promise<string> {
    const ndjson = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
    const file = this.storage.bucket(this.cfg.stagingBucket).file(objectPath);
    await file.save(Buffer.from(ndjson, 'utf8'), {
      contentType: 'application/x-ndjson',
      resumable: false,
    });
    return objectPath;
  }

  /**
   * Replace the (data_date, search_type) slice of a per-property table with the NDJSON at
   * `objectPath`: DELETE the slice, then LOAD-append. Idempotent by construction.
   */
  async deleteThenLoadSlice(
    datasetId: string,
    tableId: string,
    dataDate: string,
    searchType: string,
    objectPath: string,
  ): Promise<{ rowsLoaded: number }> {
    // Retry the DML + load: a heavy backfill fans out many concurrent slices at one property table
    // and trips BigQuery's per-table DML concurrency/rate ceilings. Those are transient — a
    // jittered backoff lets in-flight DML drain and the slice succeeds. Re-running is idempotent
    // (DELETE-then-append), so a mid-way retry can never double-write.
    await withBqRetry(() =>
      this.bq.query({
        query: `DELETE FROM ${this.tableRef(datasetId, tableId)} WHERE data_date = @d AND search_type = @t`,
        params: { d: dataDate, t: searchType },
        location: this.cfg.location,
      }),
    );

    const file = this.storage.bucket(this.cfg.stagingBucket).file(objectPath);
    const [job] = await withBqRetry(() =>
      this.bq
        .dataset(datasetId)
        .table(tableId)
        .load(file, {
          sourceFormat: 'NEWLINE_DELIMITED_JSON',
          schema: toBigQuerySchema(GSC_ROW_SCHEMA),
          writeDisposition: 'WRITE_APPEND',
        }),
    );
    const outputRows = job.statistics?.load?.outputRows;
    return { rowsLoaded: outputRows ? Number(outputRows) : 0 };
  }

  /** Append one row to the append-only task attempt log (SPEC §6.1). */
  async appendTaskLog(fields: readonly BqField[], row: TaskLogRow): Promise<void> {
    await this.ensureTable(DATASETS.taskLogs, 'attempts', fields);
    await this.bq.dataset(DATASETS.taskLogs).table('attempts').insert([row]);
  }

  /**
   * Sum clicks/impressions of the byProperty rows for one (property, day, type) — the basis of
   * the totals anonymized-query delta (SPEC §7.2). Returns zeros if the table/slice doesn't exist.
   */
  async sumByProperty(
    sanitizedTableName: string,
    dataDate: string,
    searchType: string,
  ): Promise<{ clicks: number; impressions: number }> {
    const table = this.bq.dataset(DATASETS.byProperty).table(sanitizedTableName);
    const [exists] = await table.exists();
    if (!exists) return { clicks: 0, impressions: 0 };
    const [rows] = await this.bq.query({
      query: `SELECT IFNULL(SUM(clicks),0) AS clicks, IFNULL(SUM(impressions),0) AS impressions
              FROM ${this.tableRef(DATASETS.byProperty, sanitizedTableName)}
              WHERE data_date = @d AND search_type = @t`,
      params: { d: dataDate, t: searchType },
      location: this.cfg.location,
    });
    const r = rows[0] as { clicks?: number; impressions?: number } | undefined;
    return { clicks: Number(r?.clicks ?? 0), impressions: Number(r?.impressions ?? 0) };
  }

  /** Run a read query and return rows (used by the API for logs/doctor; sa-api jobUser+dataViewer). */
  async queryRows(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const [rows] = await this.bq.query({
      query: sql,
      location: this.cfg.location,
      ...(params ? { params } : {}),
    });
    return rows as Record<string, unknown>[];
  }

  /** Create or replace a view in the gsc_views dataset (property-group union views, SPEC §6.4). */
  async createOrReplaceView(viewId: string, selectSql: string): Promise<void> {
    await this.bq.query({
      query: `CREATE OR REPLACE VIEW \`${this.cfg.projectId}.${DATASETS.views}.${viewId}\` AS ${selectSql}`,
      location: this.cfg.location,
    });
  }

  /** Whether a table/view exists. */
  async tableExists(datasetId: string, tableId: string): Promise<boolean> {
    const [exists] = await this.bq.dataset(datasetId).table(tableId).exists();
    return exists;
  }

  /** Create or replace a materialized TABLE in gsc_views from a SELECT (materialized group views). */
  async createOrReplaceTable(tableId: string, selectSql: string): Promise<void> {
    await this.bq.query({
      query: `CREATE OR REPLACE TABLE \`${this.cfg.projectId}.${DATASETS.views}.${tableId}\` AS ${selectSql}`,
      location: this.cfg.location,
    });
  }

  /** Drop a table in gsc_views if it exists (unmaterialize / group deletion). */
  async dropTableIfExists(tableId: string): Promise<void> {
    await this.bq.query({
      query: `DROP TABLE IF EXISTS \`${this.cfg.projectId}.${DATASETS.views}.${tableId}\``,
      location: this.cfg.location,
    });
  }

  /** Drop a view in gsc_views if it exists (group deletion). */
  async dropViewIfExists(viewId: string): Promise<void> {
    await this.bq.query({
      query: `DROP VIEW IF EXISTS \`${this.cfg.projectId}.${DATASETS.views}.${viewId}\``,
      location: this.cfg.location,
    });
  }

  /** Standing invariant (SPEC §9): no row_hash appears more than once. */
  async assertNoDuplicateRowHashes(
    datasetId: string,
    tableId: string,
  ): Promise<{ ok: boolean; duplicates: number }> {
    const [rows] = await this.bq.query({
      query: `SELECT row_hash FROM ${this.tableRef(datasetId, tableId)} GROUP BY row_hash HAVING COUNT(*) > 1`,
      location: this.cfg.location,
    });
    return { ok: rows.length === 0, duplicates: rows.length };
  }
}
