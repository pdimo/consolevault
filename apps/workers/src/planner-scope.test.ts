/**
 * Scoped reconcile: tracking a property fires a run limited to it, so data starts arriving without
 * waiting for the daily cron. The unscoped call must keep sweeping everything — that is the daily
 * run, and narrowing it by accident would silently stop collection for every other property.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  created: [] as Array<{ id: string; propertyId: string }>,
  reset() {
    this.created = [];
  },
}));

const property = (id: string, included = true, source?: string) => ({
  id,
  siteUrl: `https://${id}.example/`,
  propertyType: 'url_prefix',
  sanitizedTableName: id,
  included,
  ...(source ? { source } : {}),
  accountIds: ['acct-1'],
  preferredAccountId: 'acct-1',
  config: { types: ['web'], aggregations: ['byProperty'], offsetDays: 2, backfillMonths: 1 },
});

vi.mock('@consolevault/store', async (orig) => {
  const actual = await orig<typeof import('@consolevault/store')>();
  class PropertyRepository {
    async list() {
      return [
        property('alpha'),
        property('beta'),
        property('gamma'),
        property('untracked', false),
        property('imported', true, 'native_export'),
      ];
    }
  }
  class TaskRepository {
    async listByProperty() {
      return [];
    }
    async createMany(tasks: Array<{ id: string; propertyId: string }>) {
      state.created.push(...tasks);
      return tasks.length;
    }
  }
  return { ...actual, PropertyRepository, TaskRepository };
});

const { reconcile } = await import('./planner.js');

const scheduledProperties = () => [...new Set(state.created.map((t) => t.propertyId))].sort();

describe('reconcile — property scoping', () => {
  beforeEach(() => state.reset());

  it('sweeps every tracked API property when unscoped (the daily run)', async () => {
    const result = await reconcile();
    expect(scheduledProperties()).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.properties).toBe(3);
  });

  it('limits work to the named properties when scoped', async () => {
    const result = await reconcile(['beta']);
    expect(scheduledProperties()).toEqual(['beta']);
    expect(result.properties).toBe(1);
  });

  it('still honours tracking and native-export exclusions inside a scope', async () => {
    // Asking for an untracked property, or one imported from a Bulk Export, must not collect it —
    // the scope narrows the daily sweep, it does not override its rules.
    await reconcile(['untracked', 'imported', 'alpha']);
    expect(scheduledProperties()).toEqual(['alpha']);
  });

  it('treats an empty scope as unscoped rather than collecting nothing', async () => {
    await reconcile([]);
    expect(scheduledProperties()).toEqual(['alpha', 'beta', 'gamma']);
  });
});
