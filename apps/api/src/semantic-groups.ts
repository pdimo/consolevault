/**
 * Semantic-group CRUD (content groups + topic clusters). Scoped to a client target — a property or
 * a rollup — so both get the same grouping features. Thin layer over SemanticGroupRepository;
 * validates the rule shape. Legacy `/api/properties/:id/...` paths are kept as aliases.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { SemanticGroupRepository } from '@consolevault/store';
import type { MatchRule, SemanticGroup } from '@consolevault/types';
import { HttpError } from './errors.js';

const OPS: MatchRule['op'][] = ['contains', 'starts_with', 'equals', 'regex'];

function parseRules(input: unknown, kind: SemanticGroup['kind']): MatchRule[] {
  if (!Array.isArray(input)) return [];
  const dim: MatchRule['dimension'] = kind === 'content' ? 'page' : 'query';
  return input
    .map((r) => r as Partial<MatchRule>)
    .filter((r) => typeof r.value === 'string' && r.value.trim())
    .map((r) => ({
      dimension: dim,
      op: OPS.includes(r.op as MatchRule['op']) ? (r.op as MatchRule['op']) : 'contains',
      value: String(r.value).trim(),
    }));
}

/** Build a group doc from a request body for `targetId` (reused by create + update). */
function buildGroup(targetId: string, id: string, body: Partial<SemanticGroup>): SemanticGroup {
  const name = String(body.name ?? '').trim();
  if (!name) throw new HttpError(400, 'name is required');
  const kind: SemanticGroup['kind'] = body.kind === 'content' ? 'content' : 'topic';
  return {
    id,
    // `propertyId` is the stored field name; it holds the target id (property or rollup).
    propertyId: targetId,
    kind,
    name,
    ...(body.priority ? { priority: true } : {}),
    rules: parseRules(body.rules, kind),
    updatedAt: new Date().toISOString(),
  };
}

export function registerSemanticGroupRoutes(app: FastifyInstance): void {
  const repo = new SemanticGroupRepository();

  const list = async (targetId: string, kindRaw?: string): Promise<SemanticGroup[]> =>
    repo.listForTarget(
      targetId,
      kindRaw === 'content' || kindRaw === 'topic' ? kindRaw : undefined,
    );

  const create = async (targetId: string, body: Partial<SemanticGroup>): Promise<SemanticGroup> => {
    const group = buildGroup(targetId, randomUUID(), body);
    await repo.upsert(group);
    return group;
  };

  const update = async (
    targetId: string,
    gid: string,
    body: Partial<SemanticGroup>,
  ): Promise<SemanticGroup> => {
    const group = buildGroup(targetId, gid, body);
    await repo.upsert(group);
    return group;
  };

  // --- Target-scoped (property or rollup) ---
  app.get('/api/clients/:type/:id/semantic-groups', async (req) => {
    const { id } = req.params as { id: string };
    return list(id, (req.query as { kind?: string }).kind);
  });
  app.post('/api/clients/:type/:id/semantic-groups', async (req) => {
    const { id } = req.params as { id: string };
    return create(id, (req.body ?? {}) as Partial<SemanticGroup>);
  });
  app.put('/api/clients/:type/:id/semantic-groups/:gid', async (req) => {
    const { id, gid } = req.params as { id: string; gid: string };
    return update(id, gid, (req.body ?? {}) as Partial<SemanticGroup>);
  });
  app.delete('/api/clients/:type/:id/semantic-groups/:gid', async (req) => {
    const { id, gid } = req.params as { id: string; gid: string };
    await repo.delete(id, gid);
    return { ok: true };
  });

  // --- Legacy property-scoped aliases ---
  app.get('/api/properties/:id/semantic-groups', async (req) => {
    const { id } = req.params as { id: string };
    return list(id, (req.query as { kind?: string }).kind);
  });
  app.post('/api/properties/:id/semantic-groups', async (req) => {
    const { id } = req.params as { id: string };
    return create(id, (req.body ?? {}) as Partial<SemanticGroup>);
  });
  app.put('/api/properties/:id/semantic-groups/:gid', async (req) => {
    const { id, gid } = req.params as { id: string; gid: string };
    return update(id, gid, (req.body ?? {}) as Partial<SemanticGroup>);
  });
  app.delete('/api/properties/:id/semantic-groups/:gid', async (req) => {
    const { id, gid } = req.params as { id: string; gid: string };
    await repo.delete(id, gid);
    return { ok: true };
  });
}
