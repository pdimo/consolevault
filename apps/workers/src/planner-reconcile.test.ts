/**
 * Reconcile planner (SPEC §7.2 / §8) with a mocked Firestore layer. Proves the totals gate: a
 * `totals` day is only scheduled once its `byProperty` day is terminal, so the anonymized-query
 * delta can never subtract an incomplete (0) byProperty sum.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  created: [] as Array<{ id: string; searchType: string; aggregation: string; dataDate: string }>,
  existing: new Map<
    string,
    { id: string; status: string; searchType: string; aggregation: string; dataDate: string }
  >(),
  reset() {
    this.created = [];
    this.existing = new Map();
  },
}));

vi.mock('@consolevault/store', async (orig) => {
  const actual = await orig<typeof import('@consolevault/store')>();
  class PropertyRepository {
    async list() {
      return [
        {
          id: 'urlp_test',
          siteUrl: 'https://www.test.com/',
          propertyType: 'url_prefix',
          sanitizedTableName: 'urlp_test',
          included: true,
          accountIds: ['acct-1'],
          preferredAccountId: 'acct-1',
          // Small backfill window so the test stays fast (~a few weeks of days).
          config: {
            types: ['web'],
            aggregations: ['byProperty', 'totals'],
            offsetDays: 2,
            backfillMonths: 1,
          },
        },
      ];
    }
  }
  class TaskRepository {
    async listByProperty() {
      return [...state.existing.values()];
    }
    async createMany(
      tasks: Array<{ id: string; searchType: string; aggregation: string; dataDate: string }>,
    ) {
      for (const t of tasks) {
        state.created.push(t);
        state.existing.set(t.id, { ...t, status: 'pending' });
      }
      return tasks.length;
    }
  }
  return { ...actual, PropertyRepository, TaskRepository };
});

const { reconcile } = await import('./planner.js');
const { taskId } = await import('@consolevault/store');

describe('reconcile — totals gate (SPEC §7.2)', () => {
  beforeEach(() => state.reset());

  it('defers every totals day while byProperty is not yet terminal', async () => {
    await reconcile();
    const byAgg = (agg: string) => state.created.filter((t) => t.aggregation === agg);
    expect(byAgg('byProperty').length).toBeGreaterThan(0);
    expect(byAgg('totals')).toHaveLength(0); // no byProperty day terminal yet → no totals scheduled
  });

  it('schedules a totals day only once its byProperty day is terminal', async () => {
    // First pass creates the byProperty tasks (all pending).
    await reconcile();
    const bpDays = state.created
      .filter((t) => t.aggregation === 'byProperty')
      .map((t) => t.dataDate);
    expect(bpDays.length).toBeGreaterThan(1);

    // Mark exactly one byProperty day terminal (as the collector would after loading its rows).
    const finalDay = bpDays[0]!;
    const bpId = taskId('urlp_test', 'web', 'byProperty', finalDay);
    state.existing.set(bpId, {
      id: bpId,
      status: 'collected_with_data',
      searchType: 'web',
      aggregation: 'byProperty',
      dataDate: finalDay,
    });

    // Second pass: a totals task appears for that day only.
    state.created = [];
    await reconcile();
    const totalsDays = state.created
      .filter((t) => t.aggregation === 'totals')
      .map((t) => t.dataDate);
    expect(totalsDays).toEqual([finalDay]);
  });
});
