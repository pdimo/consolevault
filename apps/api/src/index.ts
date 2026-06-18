/**
 * ConsoleVault control-plane API (Cloud Run).
 *
 * Stage 1: `/health`, the `/api/*` control-plane routes (accounts + property discovery), and it
 * serves the built SPA (`apps/web`) when present in the image. The service is IAM-private; the
 * admin reaches it via `gcloud run services proxy`. No app-level login yet (Stage 4).
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import { getHealth } from './health.js';
import { registerApiRoutes } from './routes.js';
import { HttpError } from './errors.js';

const app = Fastify({ logger: true });

app.setErrorHandler((err: FastifyError, _req, reply) => {
  const status = err instanceof HttpError ? err.status : (err.statusCode ?? 500);
  app.log.error(err);
  void reply.code(status).send({ error: err.message });
});

app.get('/health', async () => getHealth());
registerApiRoutes(app);

// Serve the built SPA if it was bundled into the image; SPA fallback for client routes.
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/health')) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'Not found' });
  });
}

const port = Number(process.env.PORT ?? 8080);

app
  .listen({ port, host: '0.0.0.0' })
  .then((address) => {
    app.log.info(`consolevault-api listening on ${address}`);
  })
  .catch((err: unknown) => {
    app.log.error(err);
    process.exit(1);
  });
