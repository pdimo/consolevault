/** Control-plane API routes (Stage 1: accounts + property discovery). */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { DEFAULT_EXPORT_DATASET } from '@consolevault/bq';
import type { Account, CollectionConfig } from '@consolevault/types';
import {
  accountRepo,
  config,
  propertyRepo,
  secretStore,
  taskRepo,
  tasksClient,
  warehouse,
} from './deps.js';
import { deleteAccountCascade } from './accounts-cleanup.js';
import { checkAccountHealth, discoverForAccount } from './discovery.js';
import { HttpError } from './errors.js';

interface IdParams {
  id: string;
}

/**
 * The deployment's own collector service account is a fixed fact of the install — its email is
 * derived from the project id, and Terraform/bootstrap always create it. Registering it by hand
 * was pure ceremony, so it is materialised as a connection the first time the list is read and
 * shown as "awaiting access" until a Search Console property grants it.
 */
const collectorEmail = (): string => `sa-collector@${config.projectId}.iam.gserviceaccount.com`;

async function ensureCollectorAccount(existing: Account[]): Promise<Account | null> {
  const email = collectorEmail();
  if (existing.some((a) => a.email === email)) return null;
  const account: Account = {
    id: randomUUID(),
    type: 'service_account',
    displayName: 'Collector service account',
    email,
    builtIn: true,
    tokenHealth: 'valid',
    createdAt: new Date().toISOString(),
  };
  await accountRepo.create(account);
  return account;
}

export function registerApiRoutes(app: FastifyInstance): void {
  // Accounts enriched with a live property count (how many properties each connection reaches) so
  // the UI can warn what a removal affects. For bigquery_export the count is its imported properties.
  app.get('/api/accounts', async () => {
    const stored = await accountRepo.list();
    const created = await ensureCollectorAccount(stored);
    const [accounts, properties] = await Promise.all([
      created ? [...stored, created] : stored,
      propertyRepo.list(),
    ]);
    const counts = new Map<string, number>();
    for (const p of properties) {
      for (const aid of p.accountIds) counts.set(aid, (counts.get(aid) ?? 0) + 1);
    }
    // Derive builtIn rather than trusting the stored flag alone: installs that registered the
    // collector by hand before it was automatic have the row but not the flag.
    return accounts.map((a) => ({
      ...a,
      builtIn: a.builtIn === true || a.email === collectorEmail(),
      propertyCount: counts.get(a.id) ?? 0,
    }));
  });

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

  // Register a native BigQuery Bulk Export connection (SPEC §12): points at an existing GSC export
  // dataset. Not an auth method — no token. Properties are discovered from BigQuery, not the API.
  app.post('/api/accounts/bigquery-export', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; projectId?: string; datasetId?: string };
    const projectId = body.projectId?.trim() || config.projectId;
    const datasetId = body.datasetId?.trim() || DEFAULT_EXPORT_DATASET;
    const id = randomUUID();
    const account: Account = {
      id,
      type: 'bigquery_export',
      displayName: body.name?.trim() || `BigQuery export (${datasetId})`,
      tokenHealth: 'valid',
      createdAt: new Date().toISOString(),
      exportDataset: { projectId, datasetId },
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

  // The built-in collector is intrinsic to the deployment — ensureCollectorAccount would just
  // recreate it on the next list, which reads as a bug. Refuse rather than churn.
  app.delete<{ Params: IdParams }>('/api/accounts/:id', async (req) => {
    const account = await accountRepo.get(req.params.id);
    if (account && (account.builtIn === true || account.email === collectorEmail())) {
      throw new HttpError(
        400,
        "This deployment's own collector service account can't be removed. Revoke its access in Search Console instead.",
      );
    }
    return deleteAccountCascade(req.params.id, {
      accountRepo,
      taskRepo,
      secretStore,
      tasksClient,
      propertyRepo,
      warehouse,
      config,
    });
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
      clientId?: string;
    };
    if (typeof body.included === 'boolean') {
      await propertyRepo.setIncluded(req.params.id, body.included);
    }
    if (typeof body.clientId === 'string' && body.clientId) {
      await propertyRepo.setClient(req.params.id, body.clientId);
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
