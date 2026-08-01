/**
 * Collector (SPEC §5.2): collect one (property, aggregation, type, day), idempotently.
 *
 * Paginate to the 50K ceiling → hash rows → NDJSON to GCS → delete-then-load the partition slice
 * Finality is data-driven (SPEC §8): query dataState=all; a day < first_incomplete_date is FINAL
 * (locks as collected_with_data/collected_no_data), otherwise it's `collected_fresh` and re-collects
 * until final. Retryable failures (quota/5xx) re-throw so Cloud Tasks backs off.
 *
 * Runs as sa-collector (the only SA with BigQuery dataEditor/jobUser + GCS objectAdmin).
 */

import { loadConfig } from '@consolevault/config';
import {
  addDays,
  classifyRetryable,
  fetchFirstIncompleteDate,
  isDayFinal,
  isIsoDate,
  isValidCombo,
  mapRowsToGscRows,
  MAX_ROWS_PER_DAY,
  querySearchAnalytics,
  ROWS_PER_PAGE,
  todayPacific,
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
  WILDCARD_VIEWS,
  type TaskLogRow,
} from '@consolevault/bq';
import {
  AccountRepository,
  authClientForAccount,
  ProbeCache,
  PropertyRepository,
  SecretStore,
  taskId,
  TaskRepository,
} from '@consolevault/store';
import { TASK_MAX_ATTEMPTS } from './constants.js';
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
const probeCache = new ProbeCache();

/** Only probe first_incomplete_date for days within this window of today; older days are final. */
const PROBE_LOOKBACK_DAYS = 14;

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
  extra: { rowCount?: number; apiCalls?: number; errorMessage?: string } = {},
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
    ...(extra.rowCount !== undefined ? { row_count: extra.rowCount } : {}),
    ...(extra.apiCalls !== undefined ? { api_calls: extra.apiCalls } : {}),
    ...(extra.errorMessage ? { error_message: extra.errorMessage } : {}),
  };
  await warehouse.appendTaskLog(TASK_LOGS_SCHEMA, row);
}

export async function collectTask(input: CollectInput, retryCount = 0): Promise<CollectResult> {
  const searchType: SearchType = input.searchType ?? 'web';
  const aggregation: Aggregation = input.aggregation ?? 'byProperty';
  if (!isIsoDate(input.dataDate))
    throw new Error(`Invalid dataDate (YYYY-MM-DD): ${input.dataDate}`);

  const property = await propertyRepo.get(input.propertyId);
  if (!property) throw new Error(`Property not found: ${input.propertyId}`);

  // Defensive: native-export properties are never collected (SPEC §12) — the planner already skips
  // them, but a stale queued task must not run the API path against a read-only import.
  if (property.source === 'native_export') {
    const id = taskId(input.propertyId, searchType, aggregation, input.dataDate);
    await taskRepo.setTerminal(id, 'skipped').catch(() => {});
    return { taskId: id, status: 'skipped', rows: 0 };
  }

  // Defensive: a stale task for an API-unsupported cell (e.g. discover×byProperty) is terminal-skipped,
  // not errored — the planner already filters these, but old queued tasks shouldn't spam errors.
  if (!isValidCombo(searchType, aggregation)) {
    const id = taskId(input.propertyId, searchType, aggregation, input.dataDate);
    await taskRepo.setTerminal(id, 'skipped').catch(() => {});
    return { taskId: id, status: 'skipped', rows: 0 };
  }

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
    attempts: retryCount + 1,
    accountId,
    queuedAt: startedAt,
  };
  await taskRepo.create(task);

  let apiCalls = 0; // GSC API calls this attempt (probe + pages) → task_logs.api_calls (Quota page)
  try {
    const auth = await authClientForAccount(account, secretStore);

    // Finality: `first_incomplete_date` is property/type-wide and only returned by range queries, so
    // we probe it once per (property,type) — only for RECENT days (older days are definitively final)
    // — and reuse it across the run via a short-TTL cache, counting an API call only on a cache miss.
    const todayPt = todayPacific();
    const isRecent = input.dataDate >= addDays(todayPt, -PROBE_LOOKBACK_DAYS);
    let firstIncompleteDate: string | null = null;
    if (isRecent) {
      const probe = await probeCache.getOrFetch(property.siteUrl, searchType, () =>
        fetchFirstIncompleteDate(auth, property.siteUrl, searchType, todayPt),
      );
      firstIncompleteDate = probe.firstIncompleteDate;
      if (probe.probed) apiCalls++;
    }
    const isFinal = isDayFinal(input.dataDate, firstIncompleteDate);

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
      apiCalls++;
      rawRows.push(...page);
      if (page.length === 0 || startRow + ROWS_PER_PAGE >= MAX_ROWS_PER_DAY) break;
    }

    if (rawRows.length === 0) {
      const status: TaskStatus = isFinal ? 'collected_no_data' : 'collected_fresh';
      await taskRepo.setTerminal(id, status);
      await appendLog(
        id,
        property.siteUrl,
        searchType,
        aggregation,
        input.dataDate,
        accountId,
        status,
        1,
        {
          rowCount: 0,
          apiCalls,
        },
      );
      return { taskId: id, status, rows: 0 };
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
    const mapped = mapRowsToGscRows(rawRows, mapParams, startedAt, isFinal);

    // totals pass (SPEC §7.2): keep the raw daily total and add the anonymized-query delta row
    // (total − sum(byProperty) for the day). The byProperty sum may be 0 if not yet collected;
    // re-collection while the day is fresh refines it later.
    const totalsRow = mapped[0];
    if (aggregation === 'totals' && totalsRow) {
      const sum = await warehouse.sumByProperty(
        property.sanitizedTableName,
        input.dataDate,
        searchType,
      );
      const clicks = Math.max(0, totalsRow.clicks - sum.clicks);
      const impressions = Math.max(0, totalsRow.impressions - sum.impressions);
      mapped.push({
        ...totalsRow,
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: 0,
        is_anonymized: true,
      });
    }

    const rows: GscRow[] = mapped.map((r) => ({ ...r, row_hash: rowHash(r) }));

    const dataset = datasetFor(aggregation);
    const objectPath = `collect/${id}.ndjson`;
    await warehouse.uploadNdjson(objectPath, rows);
    const tableCreated = await warehouse.ensureTable(
      dataset,
      property.sanitizedTableName,
      GSC_ROW_SCHEMA,
      {
        partitionField: PARTITION_FIELD,
        clustering: ['query'],
      },
    );
    // First table in this dataset → ensure its cross-property wildcard view exists (SPEC §6.1).
    // Wildcard views are dynamic, so this one-time create then self-includes all future properties.
    if (tableCreated) {
      const wildcard = WILDCARD_VIEWS.find((w) => w.dataset === dataset);
      if (wildcard) await warehouse.ensureWildcardView(dataset, wildcard.viewId);
    }
    const { rowsLoaded } = await warehouse.deleteThenLoadSlice(
      dataset,
      property.sanitizedTableName,
      input.dataDate,
      searchType,
      objectPath,
    );

    const status: TaskStatus = isFinal ? 'collected_with_data' : 'collected_fresh';
    await taskRepo.setTerminal(id, status);
    await appendLog(
      id,
      property.siteUrl,
      searchType,
      aggregation,
      input.dataDate,
      accountId,
      status,
      1,
      {
        rowCount: rowsLoaded,
        apiCalls,
      },
    );
    const nowIso = new Date().toISOString();
    await accountRepo.update(accountId, { lastSuccessAt: nowIso });
    // Denormalize collection status onto the property for fast list rendering (Stage 7). Only
    // advance lastCollectedDate when this day is the newest with data; always refresh the timestamp.
    const prevDate = property.status?.lastCollectedDate;
    await propertyRepo.setStatus(input.propertyId, {
      lastCollectedAt: nowIso,
      ...(!prevDate || input.dataDate >= prevDate
        ? { lastCollectedDate: input.dataDate, dataState: isFinal ? 'final' : 'fresh' }
        : {}),
    });
    return { taskId: id, status, rows: rowsLoaded };
  } catch (err) {
    const classified = classifyRetryable(err);
    const attempt = retryCount + 1;
    // Dead-letter: only mark terminal `error` once retries are exhausted (or the error isn't
    // retryable). While Cloud Tasks still has attempts left, leave the task `queued` so a retry runs
    // it — it no longer flips to `error` on the first transient failure.
    const lastAttempt = !classified.retryable || attempt >= TASK_MAX_ATTEMPTS;
    if (lastAttempt) {
      await taskRepo.setTerminal(id, 'error');
      await propertyRepo
        .setStatus(input.propertyId, {
          lastError: classified.message,
          lastErrorAt: new Date().toISOString(),
        })
        .catch(() => {});
    }
    await appendLog(
      id,
      property.siteUrl,
      searchType,
      aggregation,
      input.dataDate,
      accountId,
      lastAttempt ? 'error' : 'queued',
      attempt,
      { apiCalls, errorMessage: classified.message },
    );
    throw classified;
  }
}
