/** Control-plane API routes (Stage 1: accounts + property discovery). */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Account, CollectionConfig } from '@consolevault/types';
import { accountRepo, propertyRepo } from './deps.js';
import { checkAccountHealth, discoverForAccount } from './discovery.js';
import { HttpError } from './errors.js';

interface IdParams {
  id: string;
}

export function registerApiRoutes(app: FastifyInstance): void {
  app.get('/api/accounts', async () => accountRepo.list());

  // Register a service-account account (impersonation). OAuth accounts are added by the
  // local helper (they need a browser/loopback), not via this deployed API.
  app.post('/api/accounts/service-account', async (req, reply) => {
    const body = (req.body ?? {}) as { email?: string; name?: string };
    if (!body.email) throw new HttpError(400, 'email is required');
    const id = randomUUID();
    const account: Account = {
      id,
      type: 'service_account',
      displayName: body.name ?? body.email,
      email: body.email,
      tokenHealth: 'valid',
      createdAt: new Date().toISOString(),
    };
    await accountRepo.create(account);
    reply.code(201);
    return account;
  });

  app.post<{ Params: IdParams }>('/api/accounts/:id/discover', async (req) =>
    discoverForAccount(req.params.id),
  );

  app.post<{ Params: IdParams }>('/api/accounts/:id/token-health', async (req) => ({
    tokenHealth: await checkAccountHealth(req.params.id),
  }));

  app.delete<{ Params: IdParams }>('/api/accounts/:id', async (req, reply) => {
    await accountRepo.delete(req.params.id);
    reply.code(204);
  });

  app.get('/api/properties', async () => propertyRepo.list());

  // Bulk track / untrack (Stage 7 — Properties workflow).
  app.post('/api/properties/bulk', async (req) => {
    const body = (req.body ?? {}) as { ids?: string[]; included?: boolean };
    if (!Array.isArray(body.ids) || typeof body.included !== 'boolean') {
      throw new HttpError(400, 'ids[] and included are required');
    }
    const included = body.included;
    await Promise.all(body.ids.map((id) => propertyRepo.setIncluded(id, included)));
    return { updated: body.ids.length };
  });

  app.patch<{ Params: IdParams }>('/api/properties/:id', async (req) => {
    const body = (req.body ?? {}) as {
      included?: boolean;
      config?: CollectionConfig;
      preferredAccountId?: string;
      dashboardEnabled?: boolean;
      brandTerms?: string[];
    };
    if (typeof body.included === 'boolean') {
      await propertyRepo.setIncluded(req.params.id, body.included);
    }
    if (body.config) {
      await propertyRepo.updateConfig(req.params.id, body.config);
    }
    if (body.preferredAccountId) {
      await propertyRepo.setPreferredAccount(req.params.id, body.preferredAccountId);
    }
    if (typeof body.dashboardEnabled === 'boolean') {
      await propertyRepo.setDashboardEnabled(req.params.id, body.dashboardEnabled);
    }
    if (Array.isArray(body.brandTerms)) {
      await propertyRepo.setBrandTerms(
        req.params.id,
        body.brandTerms.map((t) => String(t).trim()).filter(Boolean),
      );
    }
    const property = await propertyRepo.get(req.params.id);
    if (!property) throw new HttpError(404, 'Property not found');
    return property;
  });
}
