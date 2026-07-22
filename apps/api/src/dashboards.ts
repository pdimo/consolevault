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
  DashboardCache,
  DashboardService,
  SavedFilterRepository,
  type ReportName,
} from '@consolevault/store';
import type { DashboardListItem, SavedFilter } from '@consolevault/types';
import { config, groupRepo, propertyRepo, warehouse } from './deps.js';
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

  // All manageable clients (tracked properties + all groups) — the client-first workspace list.
  // NOT gated on dashboardEnabled (that flag now only controls daily cache warming): every tracked
  // client has a report, served on demand by the same byte-capped report endpoints below.
  app.get('/api/clients', async (): Promise<DashboardListItem[]> => {
    const [properties, groups] = await Promise.all([propertyRepo.list(), groupRepo.list()]);
    return [
      ...properties
        .filter((p) => p.included)
        .map((p) => ({
          type: 'property' as const,
          id: p.id,
          name: p.siteUrl,
          ...(p.brandTerms?.length ? { brandTerms: p.brandTerms } : {}),
        })),
      ...groups.map((g) => ({
        type: 'group' as const,
        id: g.id,
        name: g.name,
        ...(g.brandTerms?.length ? { brandTerms: g.brandTerms } : {}),
      })),
    ];
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
