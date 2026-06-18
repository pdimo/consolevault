/**
 * ConsoleVault collector worker (Cloud Run, runs as sa-collector).
 *
 * Stage 2: `POST /collect` runs one collection (headless manual trigger). Cloud Tasks/Workflows
 * will invoke this same endpoint with retries/backoff in Stage 3.
 */

import Fastify from 'fastify';
import { CollectionError } from '@consolevault/gsc';
import { collectTask, type CollectInput } from './collector.js';

const app = Fastify({ logger: true });

app.get('/health', async () => ({ status: 'ok', service: 'consolevault-collector', stage: 2 }));

app.post('/collect', async (req, reply) => {
  const body = (req.body ?? {}) as Partial<CollectInput>;
  if (!body.propertyId || !body.dataDate) {
    return reply.code(400).send({ error: 'propertyId and dataDate are required' });
  }
  try {
    return await collectTask({
      propertyId: body.propertyId,
      dataDate: body.dataDate,
      ...(body.searchType ? { searchType: body.searchType } : {}),
      ...(body.aggregation ? { aggregation: body.aggregation } : {}),
    });
  } catch (err) {
    // Retryable (quota/5xx) → 503 so Cloud Tasks backs off (Stage 3); else 500.
    const retryable = err instanceof CollectionError && err.retryable;
    const message = err instanceof Error ? err.message : String(err);
    app.log.error(err);
    return reply.code(retryable ? 503 : 500).send({ error: message, retryable });
  }
});

const port = Number(process.env.PORT ?? 8080);

app
  .listen({ port, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`consolevault-collector listening on ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
