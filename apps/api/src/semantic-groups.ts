/**
 * Semantic-group CRUD (per-property content groups + topic clusters). Thin layer over
 * SemanticGroupRepository; validates the rule shape. Drives report grouping (Phase 2b).
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

export function registerSemanticGroupRoutes(app: FastifyInstance): void {
  const repo = new SemanticGroupRepository();

  app.get('/api/properties/:id/semantic-groups', async (req): Promise<SemanticGroup[]> => {
    const { id } = req.params as { id: string };
    const kind = (req.query as { kind?: string }).kind;
    return repo.listForProperty(id, kind === 'content' || kind === 'topic' ? kind : undefined);
  });

  app.post('/api/properties/:id/semantic-groups', async (req): Promise<SemanticGroup> => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as Partial<SemanticGroup>;
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name is required');
    const kind: SemanticGroup['kind'] = body.kind === 'content' ? 'content' : 'topic';
    const group: SemanticGroup = {
      id: randomUUID(),
      propertyId: id,
      kind,
      name,
      ...(body.priority ? { priority: true } : {}),
      rules: parseRules(body.rules, kind),
      updatedAt: new Date().toISOString(),
    };
    await repo.upsert(group);
    return group;
  });

  app.put('/api/properties/:id/semantic-groups/:gid', async (req): Promise<SemanticGroup> => {
    const { id, gid } = req.params as { id: string; gid: string };
    const body = (req.body ?? {}) as Partial<SemanticGroup>;
    const name = String(body.name ?? '').trim();
    if (!name) throw new HttpError(400, 'name is required');
    const kind: SemanticGroup['kind'] = body.kind === 'content' ? 'content' : 'topic';
    const group: SemanticGroup = {
      id: gid,
      propertyId: id,
      kind,
      name,
      ...(body.priority ? { priority: true } : {}),
      rules: parseRules(body.rules, kind),
      updatedAt: new Date().toISOString(),
    };
    await repo.upsert(group);
    return group;
  });

  app.delete('/api/properties/:id/semantic-groups/:gid', async (req) => {
    const { id, gid } = req.params as { id: string; gid: string };
    await repo.delete(id, gid);
    return { ok: true };
  });
}
