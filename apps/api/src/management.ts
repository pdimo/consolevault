/**
 * Management endpoints (SPEC §10): coverage heatmap, verify-setup Doctor, jobs/logs + re-collect +
 * run-now, queue status, property groups (+ union view), and settings. Mostly read-only (sa-api).
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { CloudTasksClient } from '@google-cloud/tasks';
import { ExecutionsClient } from '@google-cloud/workflows';
import {
  addDays,
  capacityEstimate,
  daysInRange,
  DISPATCH_QPM_PER_ACCOUNT,
  GSC_LIMITS,
  listSites,
  todayPacific,
  windowFor,
} from '@consolevault/gsc';
import {
  authClientForAccount,
  coverageState,
  detectDoubleCount,
  taskId,
} from '@consolevault/store';
import { buildUnionViewSql, DATASETS } from '@consolevault/bq';
import type { Aggregation, PropertyGroup, SearchType, Settings, Task } from '@consolevault/types';
import {
  accountRepo,
  config,
  groupRepo,
  propertyRepo,
  secretStore,
  settingsRepo,
  taskRepo,
  warehouse,
} from './deps.js';
import { HttpError } from './errors.js';
import { ensureAlerting } from './alerting.js';

const tasksClient = new CloudTasksClient();
const executionsClient = new ExecutionsClient();
const workflowParent = `projects/${config.projectId}/locations/${config.region}/workflows/${config.appName}-daily`;
const taskLogsTable = `\`${config.projectId}.task_logs.attempts\``;

interface IdParams {
  id: string;
}

export function registerManagementRoutes(app: FastifyInstance): void {
  // --- Coverage heatmap (Firestore-only; fast) ---
  app.get<{ Params: IdParams }>('/api/properties/:id/coverage', async (req) => {
    const property = await propertyRepo.get(req.params.id);
    if (!property) throw new HttpError(404, 'Property not found');
    const tasks = await taskRepo.listByProperty(property.id);
    const byCell = new Map(tasks.map((t) => [`${t.searchType}|${t.aggregation}|${t.dataDate}`, t]));
    const { oldest, newest } = windowFor(
      property.config.offsetDays,
      property.config.backfillMonths,
    );
    const days = daysInRange(oldest, newest);
    const cells = property.config.aggregations.flatMap((aggregation) =>
      property.config.types.map((searchType) => ({
        aggregation,
        searchType,
        days: days.map((date) => ({
          date,
          state: coverageState(byCell.get(`${searchType}|${aggregation}|${date}`)),
        })),
      })),
    );
    const collected = tasks
      .filter((t) => t.status === 'collected_with_data')
      .map((t) => t.dataDate)
      .sort();
    return { window: { oldest, newest }, cells, freshness: collected.at(-1) ?? null };
  });

  // --- Anomaly % (totals vs byProperty sum) — best-effort BQ read ---
  app.get<{ Params: IdParams }>('/api/properties/:id/anomaly', async (req) => {
    const property = await propertyRepo.get(req.params.id);
    if (!property) throw new HttpError(404, 'Property not found');
    try {
      const rows = await warehouse.queryRows(
        `SELECT SAFE_DIVIDE(SUM(IF(is_anonymized, impressions, 0)), SUM(impressions)) AS anomaly_pct
         FROM \`${config.projectId}.gsc_totals.${property.sanitizedTableName}\``,
      );
      const pct = rows[0]?.anomaly_pct;
      return { anomalyPct: pct == null ? null : Number(pct) };
    } catch {
      return { anomalyPct: null };
    }
  });

  // --- Verify-setup Doctor ---
  app.get('/api/doctor', async () => {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const accounts = await accountRepo.list();
    checks.push({
      name: 'Accounts connected',
      ok: accounts.some((a) => a.tokenHealth === 'valid'),
      detail: `${accounts.length} account(s)`,
    });

    const probe = accounts.find((a) => a.tokenHealth === 'valid') ?? accounts[0];
    try {
      if (!probe) throw new Error('no account');
      const auth = await authClientForAccount(probe, secretStore);
      const sites = await listSites(auth);
      checks.push({ name: 'GSC test query', ok: true, detail: `${sites.length} sites visible` });
    } catch (err) {
      checks.push({ name: 'GSC test query', ok: false, detail: errMsg(err) });
    }

    try {
      await warehouse.queryRows('SELECT 1 AS ok');
      checks.push({ name: 'BigQuery reachable', ok: true, detail: 'ok' });
    } catch (err) {
      checks.push({ name: 'BigQuery reachable', ok: false, detail: errMsg(err) });
    }

    try {
      const [executions] = await executionsClient.listExecutions({
        parent: workflowParent,
        pageSize: 1,
      });
      const last = executions[0];
      checks.push({
        name: 'Daily workflow',
        ok: !last || last.state !== 'FAILED',
        detail: last ? `last run: ${last.state}` : 'no runs yet',
      });
    } catch (err) {
      checks.push({ name: 'Daily workflow', ok: false, detail: errMsg(err) });
    }

    try {
      const rows = await warehouse.queryRows(
        `SELECT COUNT(*) AS n FROM ${taskLogsTable} WHERE logged_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)`,
      );
      const n = Number(rows[0]?.n ?? 0);
      checks.push({ name: 'Recent collection', ok: n > 0, detail: `${n} attempts in 7d` });
    } catch (err) {
      checks.push({ name: 'Recent collection', ok: false, detail: errMsg(err) });
    }

    try {
      const all = await propertyRepo.list();
      const byTable = new Map<string, string[]>();
      for (const p of all) {
        const list = byTable.get(p.sanitizedTableName) ?? [];
        list.push(p.siteUrl);
        byTable.set(p.sanitizedTableName, list);
      }
      const collisions = [...byTable.values()].filter((urls) => new Set(urls).size > 1);
      checks.push({
        name: 'Table-name collisions',
        ok: collisions.length === 0,
        detail:
          collisions.length === 0
            ? 'none'
            : `${collisions.length} colliding table name(s): ${collisions.map((u) => u.join(' / ')).join('; ')}`,
      });
    } catch (err) {
      checks.push({ name: 'Table-name collisions', ok: false, detail: errMsg(err) });
    }

    return { ok: checks.every((c) => c.ok), checks };
  });

  // --- Jobs / tasks (Firestore) ---
  app.get('/api/tasks', async (req) => {
    const { status, propertyId } = req.query as { status?: Task['status']; propertyId?: string };
    if (status) return taskRepo.listByStatus(status);
    if (propertyId) return taskRepo.listByProperty(propertyId);
    return taskRepo.list();
  });

  // --- Logs (task_logs.attempts, searchable by property) ---
  app.get('/api/logs', async (req) => {
    const { propertyId, limit } = req.query as { propertyId?: string; limit?: string };
    const lim = Math.min(Number(limit ?? 200) || 200, 1000);
    const where = propertyId ? 'WHERE STARTS_WITH(task_id, @prefix)' : '';
    return warehouse.queryRows(
      `SELECT task_id, property, search_type, aggregation, data_date, status, row_count, error_message, logged_at
       FROM ${taskLogsTable} ${where} ORDER BY logged_at DESC LIMIT ${lim}`,
      propertyId ? { prefix: `${propertyId}__` } : undefined,
    );
  });

  // --- Re-collect one cell (mark pending; next run collects) ---
  app.post<{ Params: IdParams }>('/api/properties/:id/recollect', async (req) => {
    const property = await propertyRepo.get(req.params.id);
    if (!property) throw new HttpError(404, 'Property not found');
    const body = (req.body ?? {}) as {
      date?: string;
      searchType?: SearchType;
      aggregation?: Aggregation;
    };
    if (!body.date) throw new HttpError(400, 'date is required');
    const searchType = body.searchType ?? 'web';
    const aggregation = body.aggregation ?? 'byProperty';
    const accountId = property.preferredAccountId ?? property.accountIds[0];
    if (!accountId) throw new HttpError(400, 'Property has no associated account');
    const id = taskId(property.id, searchType, aggregation, body.date);
    const task: Task = {
      id,
      propertyId: property.id,
      searchType,
      aggregation,
      dataDate: body.date,
      status: 'pending',
      attempts: 0,
      accountId,
    };
    await taskRepo.create(task);
    return { task: id, status: 'pending' };
  });

  // --- Requeue dead-lettered (error) tasks: reset to pending for the next run (SPEC §8) ---
  app.post('/api/tasks/requeue-errors', async () => {
    const requeued = await taskRepo.requeueErrors();
    return { requeued };
  });

  // --- Run the daily pipeline now ---
  app.post('/api/pipeline/run', async () => {
    const [execution] = await executionsClient.createExecution({ parent: workflowParent });
    return { execution: execution.name, state: execution.state };
  });

  // --- Per-account queue status ---
  app.get('/api/queues', async () => {
    const parent = tasksClient.locationPath(config.projectId, config.region);
    const [queues] = await tasksClient.listQueues({ parent });
    return queues
      .filter((q) => q.name?.includes('/cv-acct-'))
      .map((q) => ({
        name: q.name?.split('/').pop(),
        state: q.state,
        maxDispatchesPerSecond: q.rateLimits?.maxDispatchesPerSecond,
      }));
  });

  // --- Property groups (+ generated union view) ---
  app.get('/api/groups', async () => groupRepo.list());

  app.post('/api/groups', async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      memberPropertyIds?: string[];
      materialized?: boolean;
    };
    if (!body.name) throw new HttpError(400, 'name is required');
    const saved = await saveGroup({
      id: randomUUID(),
      name: body.name,
      memberPropertyIds: body.memberPropertyIds ?? [],
      ...(body.materialized ? { materialized: true } : {}),
    });
    reply.code(201);
    return saved;
  });

  app.patch<{ Params: IdParams }>('/api/groups/:id', async (req) => {
    const existing = await groupRepo.get(req.params.id);
    if (!existing) throw new HttpError(404, 'Group not found');
    const body = (req.body ?? {}) as {
      name?: string;
      memberPropertyIds?: string[];
      materialized?: boolean;
      dashboardEnabled?: boolean;
      brandTerms?: string[];
    };
    return saveGroup({
      ...existing,
      ...(body.name ? { name: body.name } : {}),
      ...(body.memberPropertyIds ? { memberPropertyIds: body.memberPropertyIds } : {}),
      ...(body.materialized !== undefined ? { materialized: body.materialized } : {}),
      ...(body.dashboardEnabled !== undefined ? { dashboardEnabled: body.dashboardEnabled } : {}),
      ...(Array.isArray(body.brandTerms)
        ? { brandTerms: body.brandTerms.map((t) => String(t).trim()).filter(Boolean) }
        : {}),
    });
  });

  app.delete<{ Params: IdParams }>('/api/groups/:id', async (req, reply) => {
    const existing = await groupRepo.get(req.params.id);
    if (existing?.viewId) await warehouse.dropViewIfExists(existing.viewId);
    if (existing)
      await warehouse.dropTableIfExists(`group_${existing.id.replace(/[^a-zA-Z0-9]/g, '_')}_mat`);
    await groupRepo.delete(req.params.id);
    reply.code(204);
  });

  // --- Wildcard views (SPEC §6.1): (re)create cross-property views over existing data ---
  app.post('/api/views/refresh', async () => {
    const created = await warehouse.refreshWildcardViews();
    return { created };
  });

  // --- Overview dashboard aggregate (Stage 7) ---
  app.get('/api/overview', async () => {
    const [accounts, properties, storage, usage, activity, errorTasks] = await Promise.all([
      accountRepo.list(),
      propertyRepo.list(),
      warehouse.storageSummary().catch(() => []),
      warehouse.apiUsage().catch(() => ({ todayTotal: 0, last7dTotal: 0, byAccount: [] })),
      warehouse.collectionActivity(14).catch(() => []),
      taskRepo.listByStatus('error').catch(() => []),
    ]);
    const tracking = properties.filter((p) => p.included).length;
    const dataRows = storage
      .filter((d) => d.dataset !== 'task_logs')
      .reduce((sum, d) => sum + d.rows, 0);
    const totalBytes = storage.reduce((sum, d) => sum + d.bytes, 0);
    const estMonthlyStorageUsd = Number(((totalBytes / 1024 ** 3) * 0.02).toFixed(2));
    const latestFinalDate = properties
      .map((p) => (p.status?.dataState === 'final' ? p.status?.lastCollectedDate : undefined))
      .filter((d): d is string => Boolean(d))
      .sort()
      .at(-1);
    return {
      accounts: {
        total: accounts.length,
        healthy: accounts.filter((a) => a.tokenHealth === 'valid').length,
      },
      properties: { tracking, available: properties.length - tracking, total: properties.length },
      rows: dataRows,
      estMonthlyStorageUsd,
      apiCallsToday: usage.todayTotal,
      openErrors: errorTasks.length,
      latestFinalDate: latestFinalDate ?? null,
      activity,
    };
  });

  // --- API quota & capacity (SPEC §13 / Stage 6) ---
  // Portfolio movers for Home: per-client web-clicks delta, last 28 days vs the prior 28.
  app.get('/api/home/movers', async () => {
    const curEnd = addDays(todayPacific(), -3);
    const curStart = addDays(curEnd, -27);
    const prevEnd = addDays(curStart, -1);
    const prevStart = addDays(prevEnd, -27);
    const [rows, properties] = await Promise.all([
      warehouse.homeMovers({ curStart, curEnd, prevStart, prevEnd }).catch(() => []),
      propertyRepo.list(),
    ]);
    const byTable = new Map(
      properties.filter((p) => p.included).map((p) => [p.sanitizedTableName, p]),
    );
    const movers = rows.flatMap((r) => {
      const p = byTable.get(r.sourceTable);
      if (!p) return [];
      const delta = r.clicks - r.prevClicks;
      return [
        {
          type: 'property' as const,
          id: p.id,
          name: p.siteUrl,
          clicks: r.clicks,
          prevClicks: r.prevClicks,
          delta,
          deltaPct: r.prevClicks > 0 ? (delta / r.prevClicks) * 100 : null,
        },
      ];
    });
    return { window: { curStart, curEnd, prevStart, prevEnd }, movers };
  });

  app.get('/api/quota', async () => {
    const [usage, accounts, properties] = await Promise.all([
      warehouse.apiUsage(),
      accountRepo.list(),
      propertyRepo.list(),
    ]);
    const included = properties.filter((p) => p.included);
    const nameById = new Map(accounts.map((a) => [a.id, a.displayName]));
    const propsByAccount = new Map<string, number>();
    for (const p of included) {
      const acct = p.preferredAccountId ?? p.accountIds[0];
      if (acct) propsByAccount.set(acct, (propsByAccount.get(acct) ?? 0) + 1);
    }
    const byAccount = usage.byAccount
      .map((u) => ({
        accountId: u.accountId,
        displayName: u.accountId ? (nameById.get(u.accountId) ?? u.accountId) : 'unattributed',
        properties: u.accountId ? (propsByAccount.get(u.accountId) ?? 0) : 0,
        callsToday: u.callsToday,
        calls7d: u.calls7d,
        tasksToday: u.tasksToday,
      }))
      .sort((a, b) => b.callsToday - a.callsToday);

    const cap = capacityEstimate(usage.todayTotal, included.length);

    return {
      limits: GSC_LIMITS,
      dispatchQpmPerAccount: DISPATCH_QPM_PER_ACCOUNT,
      // We dispatch ≤600 QPM per account vs the 1,200 QPM per-user cap → 50% headroom by design.
      perUserHeadroomPct: Math.round(
        ((GSC_LIMITS.perUserQpm - DISPATCH_QPM_PER_ACCOUNT) / GSC_LIMITS.perUserQpm) * 100,
      ),
      today: { total: usage.todayTotal, byAccount },
      last7d: { total: usage.last7dTotal, avgPerDay: Math.round(usage.last7dTotal / 7) },
      capacity: { activeProperties: included.length, ...cap },
    };
  });

  // --- Costs (storage estimate + real billing spend when opted-in and flowing; SPEC §11) ---
  app.get('/api/costs', async () => {
    const datasets = await warehouse.storageSummary();
    const totalBytes = datasets.reduce((sum, d) => sum + d.bytes, 0);
    const gib = totalBytes / 1024 ** 3;
    // Estimate only: BigQuery active logical storage ≈ $0.02/GiB/month (US multi-region).
    const estMonthlyStorageUsd = Number((gib * 0.02).toFixed(2));
    const billingDataset = process.env.BILLING_EXPORT_DATASET;
    const { billingExportEnabled } = await settingsRepo.get();
    // Real spend is shown only when the user has opted in (UI) and the export is populated.
    const spend =
      billingExportEnabled && billingDataset ? await warehouse.billingSpend(billingDataset) : null;
    return { datasets, totalBytes, estMonthlyStorageUsd, spend };
  });

  // Guided opt-in status for the Costs page: whether the user opted in, whether the manual Console
  // export step is done (table present), and whether Google has started writing data.
  app.get('/api/costs/billing-status', async () => {
    const dataset = process.env.BILLING_EXPORT_DATASET || '';
    const { billingExportEnabled } = await settingsRepo.get();
    const status = dataset
      ? await warehouse.billingExportStatus(dataset)
      : { exportConfigured: false, dataFlowing: false, lastDataDate: null };
    return {
      enabled: billingExportEnabled ?? false,
      dataset,
      projectId: config.projectId,
      billingAccountId: process.env.BILLING_ACCOUNT_ID || '',
      ...status,
    };
  });

  // --- Settings ---
  app.get('/api/settings', async () => settingsRepo.get());
  app.put('/api/settings', async (req) => {
    const settings = req.body as Settings;
    await settingsRepo.put(settings);
    // Sync the Monitoring email channel + attach to alert policies (best-effort; never block save).
    try {
      const result = await ensureAlerting(config.projectId, settings.alertEmail ?? '');
      app.log.info({ alerting: result }, 'ensureAlerting');
    } catch (err) {
      app.log.error({ err: errMsg(err) }, 'ensureAlerting failed');
    }
    return settings;
  });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Persist a group, recomputing the double-count warning and (re)building its union view. */
async function saveGroup(group: PropertyGroup): Promise<PropertyGroup> {
  const members = (
    await Promise.all(group.memberPropertyIds.map((id) => propertyRepo.get(id)))
  ).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const doubleCountWarning = detectDoubleCount(members);
  const viewId = `group_${group.id.replace(/[^a-zA-Z0-9]/g, '_')}`;

  // A property only has a byProperty table once it's been collected. Union only the members that
  // actually exist; if none do yet, skip the view (it's (re)built when members are collected and
  // the group is next saved).
  const existing: string[] = [];
  for (const m of members) {
    if (await warehouse.tableExists(DATASETS.byProperty, m.sanitizedTableName)) {
      existing.push(m.sanitizedTableName);
    }
  }
  const unionSql = buildUnionViewSql(config.projectId, existing);
  if (existing.length > 0) {
    await warehouse.createOrReplaceView(viewId, unionSql);
  } else {
    await warehouse.dropViewIfExists(viewId);
  }

  // Materialized table (opt-in): a CREATE OR REPLACE TABLE snapshot for faster BI, kept fresh by the
  // daily workflow. Drop it when unmaterialized or no members exist.
  const matId = `${viewId}_mat`;
  if (group.materialized && existing.length > 0) {
    await warehouse.createOrReplaceTable(matId, unionSql);
  } else {
    await warehouse.dropTableIfExists(matId);
  }

  const { viewId: _previous, ...rest } = group;
  const saved: PropertyGroup = {
    ...rest,
    doubleCountWarning,
    ...(existing.length > 0 ? { viewId } : {}),
  };
  await groupRepo.upsert(saved);
  return saved;
}
