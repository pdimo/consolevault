/**
 * ConsoleVault control-plane API (Cloud Run).
 *
 * Stage 4: public-ingress but app-gated by Google Sign-In (single admin). Serves the management
 * SPA + the `/api/*` control plane (accounts, properties, coverage, doctor, jobs, groups, settings,
 * OAuth connect). Collector/orchestrator stay IAM-private.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyError } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { getHealth } from './health.js';
import { registerApiRoutes } from './routes.js';
import { authHook, registerAuthRoutes } from './auth.js';
import { registerOAuthRoutes } from './oauth.js';
import { registerManagementRoutes } from './management.js';
import { HttpError } from './errors.js';

const app = Fastify({ logger: true, trustProxy: true });

app.setErrorHandler((err: FastifyError, _req, reply) => {
  const status = err instanceof HttpError ? err.status : (err.statusCode ?? 500);
  app.log.error(err);
  void reply.code(status).send({ error: err.message });
});

await app.register(fastifyCookie);

// Enforce a valid admin session on protected /api routes (public: /health, /api/config,
// /api/auth/*, static assets).
app.addHook('onRequest', authHook);

app.get('/health', async () => getHealth());
registerAuthRoutes(app);
registerOAuthRoutes(app);
registerApiRoutes(app);
registerManagementRoutes(app);

// Serve the built SPA if bundled into the image; SPA fallback for client routes.
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
