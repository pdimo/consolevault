/**
 * ConsoleVault control-plane API (Cloud Run).
 *
 * Stage 0: serves only `GET /health`. No control-plane routes, no auth, no GSC logic.
 */

import Fastify from 'fastify';
import { getHealth } from './health.js';

const app = Fastify({ logger: true });

app.get('/health', async () => getHealth());

// Cloud Run provides PORT; bind to 0.0.0.0 inside the container.
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
