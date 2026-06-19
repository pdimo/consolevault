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
import { collectTask, type CollectInput } from './collector.js';
import { reconcile } from './planner.js';
import { enqueueAll } from './enqueue.js';
import { tokenHealthSweep } from './health.js';

const app = Fastify({ logger: true });
const config = loadConfig();
const secretStore = new SecretStore(config.projectId);

app.get('/health', async () => ({ status: 'ok', service: 'consolevault-workers', stage: 3 }));

// --- collector (sa-collector) ---
app.post('/collect', async (req, reply) => {
  const body = (req.body ?? {}) as Partial<CollectInput>;
  if (!body.propertyId || !body.dataDate) {
    return reply.code(400).send({ error: 'propertyId and dataDate are required' });
  }
  try {
    const result = await collectTask({
      propertyId: body.propertyId,
      dataDate: body.dataDate,
      ...(body.searchType ? { searchType: body.searchType } : {}),
      ...(body.aggregation ? { aggregation: body.aggregation } : {}),
    });
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
app.post('/discover-all', async () => discoverAllAccounts(secretStore));
app.post('/reconcile', async () => reconcile());
app.post('/enqueue', async () => enqueueAll());
app.post('/token-health-sweep', async () => tokenHealthSweep(secretStore, app.log));

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
