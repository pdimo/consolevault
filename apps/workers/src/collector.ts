/**
 * Collector (SPEC §5.2): collect one (property, aggregation, type, day), idempotently.
 *
 * Paginate to the 50K ceiling → hash rows → NDJSON to GCS → delete-then-load the partition slice
 * → terminal state + append-only task log. Empty result → `collected_no_data` (terminal, distinct
 * from error). Retryable failures (quota/5xx) re-throw so Cloud Tasks backs off in Stage 3.
 *
 * Runs as sa-collector (the only SA with BigQuery dataEditor/jobUser + GCS objectAdmin).
 */

import { loadConfig } from '@consolevault/config';
import {
  classifyRetryable,
  isIsoDate,
  mapRowsToGscRows,
  MAX_ROWS_PER_DAY,
  querySearchAnalytics,
  ROWS_PER_PAGE,
  type GscApiRow,
  type SearchAnalyticsQueryParams,
} from '@consolevault/gsc';
import {
  DATASETS,
  GSC_ROW_SCHEMA,
  PARTITION_FIELD,
  rowHash,
  TASK_LOGS_SCHEMA,
  Warehouse,
  type TaskLogRow,
} from '@consolevault/bq';
import {
  AccountRepository,
  authClientForAccount,
  PropertyRepository,
  SecretStore,
  taskId,
  TaskRepository,
} from '@consolevault/store';
import type { Aggregation, GscRow, SearchType, Task, TaskStatus } from '@consolevault/types';

const config = loadConfig();
if (!config.stagingBucket) {
  throw new Error('STAGING_BUCKET is required for the collector.');
}

const warehouse = new Warehouse({
  projectId: config.projectId,
  location: config.bqLocation,
  stagingBucket: config.stagingBucket,
});
const accountRepo = new AccountRepository();
const propertyRepo = new PropertyRepository();
const taskRepo = new TaskRepository();
const secretStore = new SecretStore(config.projectId);

/** Dataset for an aggregation (Stage 2 only exercises byProperty). */
function datasetFor(aggregation: Aggregation): string {
  if (aggregation === 'byPage') return DATASETS.byPage;
  if (aggregation === 'totals') return DATASETS.totals;
  return DATASETS.byProperty;
}

export interface CollectInput {
  propertyId: string;
  dataDate: string;
  searchType?: SearchType;
  aggregation?: Aggregation;
}

export interface CollectResult {
  taskId: string;
  status: TaskStatus;
  rows: number;
}

async function appendLog(
  id: string,
  propertyUrl: string,
  searchType: SearchType,
  aggregation: Aggregation,
  dataDate: string,
  accountId: string,
  status: TaskStatus,
  attempt: number,
  rowCount?: number,
  errorMessage?: string,
): Promise<void> {
  const row: TaskLogRow = {
    task_id: id,
    property: propertyUrl,
    search_type: searchType,
    aggregation,
    data_date: dataDate,
    account_id: accountId,
    status,
    attempt,
    logged_at: new Date().toISOString(),
    ...(rowCount !== undefined ? { row_count: rowCount } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {}),
  };
  await warehouse.appendTaskLog(TASK_LOGS_SCHEMA, row);
}

export async function collectTask(input: CollectInput): Promise<CollectResult> {
  const searchType: SearchType = input.searchType ?? 'web';
  const aggregation: Aggregation = input.aggregation ?? 'byProperty';
  if (!isIsoDate(input.dataDate))
    throw new Error(`Invalid dataDate (YYYY-MM-DD): ${input.dataDate}`);

  const property = await propertyRepo.get(input.propertyId);
  if (!property) throw new Error(`Property not found: ${input.propertyId}`);
  const accountId = property.preferredAccountId ?? property.accountIds[0];
  if (!accountId) throw new Error(`Property has no associated account: ${input.propertyId}`);
  const account = await accountRepo.get(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);

  const id = taskId(input.propertyId, searchType, aggregation, input.dataDate);
  const startedAt = new Date().toISOString();
  const task: Task = {
    id,
    propertyId: input.propertyId,
    searchType,
    aggregation,
    dataDate: input.dataDate,
    status: 'queued',
    attempts: 1,
    accountId,
    queuedAt: startedAt,
  };
  await taskRepo.create(task);

  try {
    const auth = await authClientForAccount(account, secretStore);

    // Paginate 25K/page until empty or the 50K/day/type ceiling.
    const rawRows: GscApiRow[] = [];
    for (let startRow = 0; ; startRow += ROWS_PER_PAGE) {
      const params: SearchAnalyticsQueryParams = {
        siteUrl: property.siteUrl,
        startDate: input.dataDate,
        endDate: input.dataDate,
        searchType,
        aggregation,
        startRow,
        rowLimit: ROWS_PER_PAGE,
      };
      const page = await querySearchAnalytics(auth, params);
      rawRows.push(...page);
      if (page.length === 0 || startRow + ROWS_PER_PAGE >= MAX_ROWS_PER_DAY) break;
    }

    if (rawRows.length === 0) {
      await taskRepo.setTerminal(id, 'collected_no_data');
      await appendLog(
        id,
        property.siteUrl,
        searchType,
        aggregation,
        input.dataDate,
        accountId,
        'collected_no_data',
        1,
        0,
      );
      return { taskId: id, status: 'collected_no_data', rows: 0 };
    }

    const mapParams: SearchAnalyticsQueryParams = {
      siteUrl: property.siteUrl,
      startDate: input.dataDate,
      endDate: input.dataDate,
      searchType,
      aggregation,
      startRow: 0,
      rowLimit: ROWS_PER_PAGE,
    };
    const rows: GscRow[] = mapRowsToGscRows(rawRows, mapParams, startedAt).map((r) => ({
      ...r,
      row_hash: rowHash(r),
    }));

    const dataset = datasetFor(aggregation);
    const objectPath = `collect/${id}.ndjson`;
    await warehouse.uploadNdjson(objectPath, rows);
    await warehouse.ensureTable(dataset, property.sanitizedTableName, GSC_ROW_SCHEMA, {
      partitionField: PARTITION_FIELD,
      clustering: ['query'],
    });
    const { rowsLoaded } = await warehouse.deleteThenLoadSlice(
      dataset,
      property.sanitizedTableName,
      input.dataDate,
      searchType,
      objectPath,
    );

    await taskRepo.setTerminal(id, 'collected_with_data');
    await appendLog(
      id,
      property.siteUrl,
      searchType,
      aggregation,
      input.dataDate,
      accountId,
      'collected_with_data',
      1,
      rowsLoaded,
    );
    await accountRepo.update(accountId, { lastSuccessAt: new Date().toISOString() });
    return { taskId: id, status: 'collected_with_data', rows: rowsLoaded };
  } catch (err) {
    const classified = classifyRetryable(err);
    await taskRepo.setTerminal(id, 'error');
    await appendLog(
      id,
      property.siteUrl,
      searchType,
      aggregation,
      input.dataDate,
      accountId,
      'error',
      1,
      undefined,
      classified.message,
    );
    throw classified;
  }
}
