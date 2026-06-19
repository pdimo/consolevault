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
    if (exists) return false;
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
    await this.bq.query({
      query: `DELETE FROM ${this.tableRef(datasetId, tableId)} WHERE data_date = @d AND search_type = @t`,
      params: { d: dataDate, t: searchType },
      location: this.cfg.location,
    });

    const file = this.storage.bucket(this.cfg.stagingBucket).file(objectPath);
    const [job] = await this.bq
      .dataset(datasetId)
      .table(tableId)
      .load(file, {
        sourceFormat: 'NEWLINE_DELIMITED_JSON',
        schema: toBigQuerySchema(GSC_ROW_SCHEMA),
        writeDisposition: 'WRITE_APPEND',
      });
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
