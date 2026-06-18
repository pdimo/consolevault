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

  /** Create a table (idempotently) — DATE-partitioned + clustered when requested. */
  async ensureTable(
    datasetId: string,
    tableId: string,
    fields: readonly BqField[],
    opts: EnsureTableOptions = {},
  ): Promise<void> {
    const table = this.bq.dataset(datasetId).table(tableId);
    const [exists] = await table.exists();
    if (exists) return;
    const metadata: TableMetadata = { schema: toBigQuerySchema(fields) };
    if (opts.partitionField) {
      metadata.timePartitioning = { type: 'DAY', field: opts.partitionField };
    }
    if (opts.clustering?.length) {
      metadata.clustering = { fields: opts.clustering };
    }
    await this.bq.dataset(datasetId).createTable(tableId, metadata);
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
