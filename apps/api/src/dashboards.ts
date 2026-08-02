/**
 * Dashboards API (analytics, read-only). Thin layer over the shared DashboardService (resolves the
 * target → BigQuery source, compiles filters, runs byte-capped report SQL). Every report response is
 * cached in Firestore (short TTL) so repeat/default views serve instantly at $0 BigQuery cost; the
 * orchestrator warms the default views daily ("Morning Paper").
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  cacheKey,
  canonicalQs,
  clientNameFromSiteUrl,
  DashboardCache,
  DashboardService,
  SavedFilterRepository,
  type ReportName,
} from '@consolevault/store';
import type { DashboardListItem, SavedFilter } from '@consolevault/types';
import { clientRepo, config, groupRepo, propertyRepo, warehouse } from './deps.js';
import { HttpError } from './errors.js';

const REPORTS: ReportName[] = [
  'kpis',
  'timeseries',
  'top-queries',
  'top-pages',
  'breakdown',
  'position-buckets',
  'ctr-scatter',
  'striking-distance',
  'movers',
  'grouped-entities',
  'ctr-benchmark',
  'cannibalization',
  'content-decay',
  'brand-split',
  'brand-timeseries',
];
const HOUR = 60 * 60 * 1000;

export function registerDashboardRoutes(app: FastifyInstance): void {
  const svc = new DashboardService(warehouse, config.projectId, propertyRepo, groupRepo);
  const cache = new DashboardCache();

  // List enabled dashboards (properties + groups with dashboardEnabled).
  app.get('/api/dashboards', async (): Promise<DashboardListItem[]> => {
    const [properties, groups] = await Promise.all([propertyRepo.list(), groupRepo.list()]);
    return [
      ...properties
        .filter((p) => p.dashboardEnabled)
        .map((p) => ({
          type: 'property' as const,
          id: p.id,
          name: p.siteUrl,
          ...(p.brandTerms?.length ? { brandTerms: p.brandTerms } : {}),
        })),
      ...groups
        .filter((g) => g.dashboardEnabled)
        .map((g) => ({
          type: 'group' as const,
          id: g.id,
          name: g.name,
          ...(g.brandTerms?.length ? { brandTerms: g.brandTerms } : {}),
        })),
    ];
  });

  // Clients — the top-level businesses (IA v2). Each owns 1..N properties; its report aggregates
  // them. Migrates the legacy property-or-rollup model into real clients on first read (idempotent).
  app.get('/api/clients', async (): Promise<DashboardListItem[]> => {
    await clientRepo.ensureClients(propertyRepo, groupRepo);
    const clients = await clientRepo.listWithCounts(propertyRepo);
    return clients
      .filter((c) => c.propertyCount > 0)
      .map((c) => ({
        type: 'client' as const,
        id: c.id,
        name: c.name,
        propertyCount: c.propertyCount,
        kind: c.kind,
        ...(c.brandTerms?.length ? { brandTerms: c.brandTerms } : {}),
      }));
  });

  // One client with its member properties (for the workspace property sub-switcher).
  app.get('/api/clients/:id/detail', async (req) => {
    const { id } = req.params as { id: string };
    const client = await clientRepo.get(id);
    if (!client) throw new HttpError(404, 'Client not found');
    const properties = await propertyRepo.listByClient(id);
    return {
      ...client,
      properties: properties.map((p) => ({
        id: p.id,
        siteUrl: p.siteUrl,
        propertyType: p.propertyType,
        source: p.source ?? 'api',
      })),
    };
  });

  // Rename / set brand terms.
  app.patch('/api/clients/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { name?: string; brandTerms?: string[] };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim();
    if (Array.isArray(body.brandTerms))
      patch.brandTerms = body.brandTerms.map((t) => String(t).trim()).filter(Boolean);
    await clientRepo.update(id, patch);
    return clientRepo.get(id);
  });

  // Create a client (optionally seeded with member properties) — e.g. a rollup across N properties.
  app.post('/api/clients', async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; propertyIds?: string[] };
    if (!body.name?.trim()) throw new HttpError(400, 'name is required');
    const id = `c_${randomUUID().slice(0, 12)}`;
    await clientRepo.create({ id, name: body.name.trim(), createdAt: new Date().toISOString() });
    for (const pid of body.propertyIds ?? []) await propertyRepo.setClient(pid, id);
    reply.code(201);
    return clientRepo.get(id);
  });

  // Detach a property from its client into its own single-property client (remove from a rollup).
  async function detachToOwnClient(propertyId: string): Promise<string> {
    const p = await propertyRepo.get(propertyId);
    if (!p) throw new HttpError(404, 'Property not found');
    const id = `c_${randomUUID().slice(0, 12)}`;
    await clientRepo.create({
      id,
      name: clientNameFromSiteUrl(p.siteUrl),
      createdAt: new Date().toISOString(),
    });
    await propertyRepo.setClient(propertyId, id);
    return id;
  }
  app.post('/api/properties/:id/detach', async (req) => {
    const { id } = req.params as { id: string };
    return { clientId: await detachToOwnClient(id) };
  });

  // Delete a client — its properties are split back into their own single-property clients.
  app.delete('/api/clients/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const members = await propertyRepo.listByClient(id);
    for (const m of members) await detachToOwnClient(m.id);
    await clientRepo.delete(id);
    reply.code(204);
  });

  // One cached endpoint per report.
  for (const report of REPORTS) {
    app.get(`/api/dashboards/:type/:id/${report}`, async (req) => {
      const { type, id } = req.params as { type: string; id: string };
      const q = req.query as Record<string, unknown>;
      const key = cacheKey(type, id, report + (q.dim ? `:${q.dim}` : ''), canonicalQs(q));
      return cache.wrap(key, HOUR, () => svc.report(report, type, id, q));
    });
  }

  // Saved filter presets (report-UX convenience). Scoped by target, plus global `*`.
  const savedFilters = new SavedFilterRepository();
  app.get('/api/saved-filters', async (req): Promise<SavedFilter[]> => {
    const scope = String((req.query as { scope?: string }).scope ?? '*');
    return savedFilters.listForScope(scope);
  });
  app.post('/api/saved-filters', async (req): Promise<SavedFilter> => {
    const body = (req.body ?? {}) as Partial<SavedFilter>;
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name is required');
    const filter: SavedFilter = {
      id: randomUUID(),
      scope: String(body.scope ?? '*'),
      name,
      params: (body.params as Record<string, string>) ?? {},
      createdAt: new Date().toISOString(),
    };
    await savedFilters.upsert(filter);
    return filter;
  });
  app.delete('/api/saved-filters/:id', async (req) => {
    await savedFilters.delete((req.params as { id: string }).id);
    return { ok: true };
  });

  // Deterministic group suggestions for the "Generate automatically" button. Target-scoped so it
  // works for rollups too (the union of member tables), with the legacy property path kept.
  app.get('/api/clients/:type/:id/semantic-groups/auto', async (req) => {
    const { type, id } = req.params as { type: string; id: string };
    const kind = (req.query as { kind?: string }).kind === 'content' ? 'content' : 'topic';
    return svc.autoSuggestGroups(type, id, kind);
  });
  app.get('/api/properties/:id/semantic-groups/auto', async (req) => {
    const { id } = req.params as { id: string };
    const kind = (req.query as { kind?: string }).kind === 'content' ? 'content' : 'topic';
    return svc.autoSuggestGroups('property', id, kind);
  });
}
