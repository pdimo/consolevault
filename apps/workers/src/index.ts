/**
 * ConsoleVault workers HTTP server (Cloud Run). One image, deployed as TWO services:
 *   - collector  (sa-collector): Cloud Tasks → POST /collect
 *   - orchestrator (sa-workflows): daily Workflow → /discover-all, /reconcile, /enqueue
 * IAM (the service identity) gates which endpoints actually work on each deployment.
 */

import Fastify from 'fastify';
import { loadConfig } from '@consolevault/config';
import { CollectionError } from '@consolevault/gsc';
import { discoverAllAccounts, SecretStore } from '@consolevault/store';
import { Warehouse } from '@consolevault/bq';
import { collectTask, type CollectInput } from './collector.js';
import { reconcile } from './planner.js';
import { enqueueAll } from './enqueue.js';
import { tokenHealthSweep } from './health.js';
import { refreshMaterialized } from './materialize.js';
import { refreshDashboards } from './dashboards.js';

const app = Fastify({ logger: true });
const config = loadConfig();
const secretStore = new SecretStore(config.projectId);
const warehouse = new Warehouse({
  projectId: config.projectId,
  location: config.bqLocation,
  stagingBucket: config.stagingBucket ?? '',
});

app.get('/health', async () => ({ status: 'ok', service: 'consolevault-workers', stage: 3 }));

// --- collector (sa-collector) ---
app.post('/collect', async (req, reply) => {
  const body = (req.body ?? {}) as Partial<CollectInput>;
  if (!body.propertyId || !body.dataDate) {
    return reply.code(400).send({ error: 'propertyId and dataDate are required' });
  }
  // Cloud Tasks sets this header to the 0-based retry count for this dispatch (SPEC §8 dead-letter).
  const retryCount = Number(req.headers['x-cloudtasks-taskretrycount'] ?? 0) || 0;
  try {
    const result = await collectTask(
      {
        propertyId: body.propertyId,
        dataDate: body.dataDate,
        ...(body.searchType ? { searchType: body.searchType } : {}),
        ...(body.aggregation ? { aggregation: body.aggregation } : {}),
      },
      retryCount,
    );
    // Structured marker for the "no successful collection in 24h" absence alert.
    app.log.info({ event: 'collected', status: result.status, rows: result.rows }, 'collected');
    return result;
  } catch (err) {
    const retryable = err instanceof CollectionError && err.retryable;
    const message = err instanceof Error ? err.message : String(err);
    app.log.error(err);
    return reply.code(retryable ? 503 : 500).send({ error: message, retryable });
  }
});

// --- orchestrator (sa-workflows), called by the daily Workflow ---
// Pass the warehouse so native Bulk Export connections are (re)discovered daily (SPEC §12).
app.post('/discover-all', async () => discoverAllAccounts(secretStore, warehouse));

// A scoped run (the workflow's `propertyIds` argument, set when an admin tracks a property)
// limits reconcile/enqueue to those properties. Absent or empty → the full daily sweep.
const scopeOf = (body: unknown): string[] | undefined => {
  const ids = (body as { propertyIds?: unknown } | null)?.propertyIds;
  return Array.isArray(ids) && ids.length ? ids.filter((id): id is string => typeof id === 'string') : undefined;
};
app.post('/reconcile', async (req) => reconcile(scopeOf(req.body)));
app.post('/enqueue', async (req) => enqueueAll(scopeOf(req.body)));
app.post('/token-health-sweep', async () => tokenHealthSweep(secretStore, app.log));
app.post('/refresh-materialized', async () => refreshMaterialized());
app.post('/refresh-dashboards', async () => refreshDashboards());

// Standing dedup invariant (SPEC §9). Bounded to recent days so the daily scan is cheap; a
// violation logs the `dedup_violation` marker that the Monitoring alert watches.
app.post('/dedup-check', async () => {
  const result = await warehouse.checkRowHashInvariant(7);
  if (!result.ok) {
    app.log.error({ alert: 'dedup_violation', byView: result.byView }, 'dedup invariant violated');
  }
  return result;
});

const port = Number(process.env.PORT ?? 8080);

app
  .listen({ port, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`consolevault-workers listening on ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
