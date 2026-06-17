/**
 * BigQuery dataset names and table field schemas (SPEC §6).
 *
 * Stage 0: schema CONSTANTS ONLY. No tables are created and no write logic exists yet
 * (CLAUDE.md hard rule 3). Terraform creates the empty datasets; tables land in Stage 2.
 * The field list mirrors the `GscRow` shape in `@consolevault/types`.
 */

/** Standard BigQuery field modes. */
export type BqMode = 'REQUIRED' | 'NULLABLE' | 'REPEATED';

/** Subset of BigQuery scalar types used by ConsoleVault. */
export type BqType = 'STRING' | 'DATE' | 'TIMESTAMP' | 'INTEGER' | 'FLOAT' | 'BOOLEAN';

export interface BqField {
  name: string;
  type: BqType;
  mode: BqMode;
  description?: string;
}

/** The five BigQuery datasets (SPEC §6.1). Control state lives in Firestore, not here. */
export const DATASETS = {
  byProperty: 'gsc_byProperty',
  byPage: 'gsc_byPage',
  totals: 'gsc_totals',
  views: 'gsc_views',
  taskLogs: 'task_logs',
} as const;

export type DatasetKey = keyof typeof DATASETS;

/** The day column every GSC data table is DATE-partitioned on (SPEC §6.1). */
export const PARTITION_FIELD = 'data_date';

/**
 * Shared, nullable-shared GSC row schema (SPEC §6.2). One shape across all types/aggregations
 * so the wildcard views stay trivial. Mirrors `GscRow` in `@consolevault/types`.
 */
export const GSC_ROW_SCHEMA: readonly BqField[] = [
  { name: 'data_date', type: 'DATE', mode: 'REQUIRED' },
  { name: 'property', type: 'STRING', mode: 'REQUIRED' },
  { name: 'property_type', type: 'STRING', mode: 'REQUIRED' },
  { name: 'search_type', type: 'STRING', mode: 'REQUIRED' },
  { name: 'aggregation', type: 'STRING', mode: 'REQUIRED' },
  { name: 'query', type: 'STRING', mode: 'NULLABLE', description: 'Absent for totals & Discover' },
  { name: 'page', type: 'STRING', mode: 'NULLABLE', description: 'Only present for byPage' },
  { name: 'country', type: 'STRING', mode: 'NULLABLE' },
  { name: 'device', type: 'STRING', mode: 'NULLABLE' },
  { name: 'search_appearance', type: 'STRING', mode: 'NULLABLE' },
  { name: 'clicks', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'impressions', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'ctr', type: 'FLOAT', mode: 'REQUIRED' },
  { name: 'position', type: 'FLOAT', mode: 'REQUIRED' },
  { name: 'is_anonymized', type: 'BOOLEAN', mode: 'REQUIRED' },
  { name: 'row_hash', type: 'STRING', mode: 'REQUIRED' },
  { name: 'collected_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
  { name: 'data_state', type: 'STRING', mode: 'REQUIRED' },
] as const;

/** Append-only task attempt log (SPEC §6.1). Never updated → no contention. */
export const TASK_LOGS_SCHEMA: readonly BqField[] = [
  { name: 'task_id', type: 'STRING', mode: 'REQUIRED' },
  { name: 'property', type: 'STRING', mode: 'REQUIRED' },
  { name: 'search_type', type: 'STRING', mode: 'REQUIRED' },
  { name: 'aggregation', type: 'STRING', mode: 'REQUIRED' },
  { name: 'data_date', type: 'DATE', mode: 'REQUIRED' },
  { name: 'account_id', type: 'STRING', mode: 'NULLABLE' },
  { name: 'status', type: 'STRING', mode: 'REQUIRED' },
  { name: 'attempt', type: 'INTEGER', mode: 'REQUIRED' },
  { name: 'row_count', type: 'INTEGER', mode: 'NULLABLE' },
  { name: 'error_message', type: 'STRING', mode: 'NULLABLE' },
  { name: 'logged_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
] as const;
