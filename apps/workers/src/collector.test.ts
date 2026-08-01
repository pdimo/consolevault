/**
 * SPEC §9 dedup guarantees, proven through the real collectTask code path with the BigQuery /
 * Firestore / GSC clients mocked at the module boundary:
 *  - replay:  running a task twice yields the identical row_hash set (not doubled)
 *  - overlap: two concurrent runs of the same cell target the same delete-then-load slice
 *  - crash:   a write that throws pre-ack, then retries, replaces the slice — never appends
 * All three rest on: row_hash is deterministic, and every load is a delete-then-load of one
 * (dataset, table, date, search_type) slice.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Shared mock state, hoisted so the mocked singletons (constructed at collector import) can see it.
const state = vi.hoisted(() => ({
  uploads: [] as Array<{ objectPath: string; rows: Array<{ row_hash: string }> }>,
  slices: [] as Array<{ dataset: string; table: string; date: string; type: string }>,
  tasks: new Map<string, { status: string }>(),
  failLoadOnce: false,
  property: {
    id: 'urlp_test',
    siteUrl: 'https://www.test.com/',
    propertyType: 'url_prefix' as const,
    sanitizedTableName: 'urlp_test',
    included: true,
    accountIds: ['acct-1'],
    preferredAccountId: 'acct-1',
    config: { types: ['web'], aggregations: ['byProperty'], offsetDays: 2, backfillMonths: 16 },
  },
  reset() {
    this.uploads = [];
    this.slices = [];
    this.tasks = new Map();
    this.failLoadOnce = false;
  },
}));

// Two fixed API rows (distinct query/country/device → two distinct row_hashes).
const API_ROWS = [
  {
    keys: ['blue widgets', 'aus', 'DESKTOP'],
    clicks: 10,
    impressions: 100,
    ctr: 0.1,
    position: 3.5,
  },
  { keys: ['red widgets', 'usa', 'MOBILE'], clicks: 5, impressions: 50, ctr: 0.1, position: 5.0 },
];

vi.mock('@consolevault/config', async (orig) => ({
  ...(await orig<typeof import('@consolevault/config')>()),
  loadConfig: () => ({
    projectId: 'test',
    region: 'us-central1',
    bqLocation: 'US',
    appName: 'consolevault',
    stagingBucket: 'test-staging',
  }),
}));

vi.mock('@consolevault/bq', async (orig) => {
  const actual = await orig<typeof import('@consolevault/bq')>();
  class Warehouse {
    async uploadNdjson(objectPath: string, rows: Array<{ row_hash: string }>) {
      state.uploads.push({ objectPath, rows });
      return objectPath;
    }
    async ensureTable() {
      return false;
    }
    async ensureWildcardView() {}
    async sumByProperty() {
      return { clicks: 0, impressions: 0 };
    }
    async appendTaskLog() {}
    async deleteThenLoadSlice(
      dataset: string,
      table: string,
      date: string,
      type: string,
      objectPath: string,
    ) {
      state.slices.push({ dataset, table, date, type });
      if (state.failLoadOnce) {
        state.failLoadOnce = false;
        throw new Error('simulated write-then-crash (pre-ack)');
      }
      const up = state.uploads.find((u) => u.objectPath === objectPath);
      return { rowsLoaded: up ? up.rows.length : 0 };
    }
  }
  return { ...actual, Warehouse };
});

vi.mock('@consolevault/store', async (orig) => {
  const actual = await orig<typeof import('@consolevault/store')>();
  class TaskRepository {
    async create(t: { id: string; status: string }) {
      state.tasks.set(t.id, { status: t.status });
    }
    async get(id: string) {
      return state.tasks.get(id);
    }
    async setTerminal(id: string, status: string) {
      state.tasks.set(id, { status });
    }
  }
  class PropertyRepository {
    async get() {
      return state.property;
    }
    async setStatus() {}
  }
  class AccountRepository {
    async get() {
      return { id: 'acct-1', type: 'oauth', displayName: 'a', tokenHealth: 'valid', createdAt: '' };
    }
    async update() {}
  }
  class SecretStore {
    constructor(_projectId: string) {}
  }
  class ProbeCache {
    async getOrFetch() {
      return { firstIncompleteDate: null, probed: false };
    }
  }
  return {
    ...actual,
    TaskRepository,
    PropertyRepository,
    AccountRepository,
    SecretStore,
    ProbeCache,
    authClientForAccount: async () => ({}),
  };
});

vi.mock('@consolevault/gsc', async (orig) => {
  const actual = await orig<typeof import('@consolevault/gsc')>();
  return {
    ...actual,
    querySearchAnalytics: async (_auth: unknown, params: { startRow: number }) =>
      params.startRow === 0 ? API_ROWS : [],
    fetchFirstIncompleteDate: async () => null,
  };
});

const { collectTask } = await import('./collector.js');
const INPUT = { propertyId: 'urlp_test', dataDate: '2026-01-01', searchType: 'web' as const };
const hashes = (u: { rows: Array<{ row_hash: string }> }) => u.rows.map((r) => r.row_hash).sort();

describe('collector idempotency (SPEC §9)', () => {
  beforeEach(() => state.reset());

  it('replay: running the same task twice yields the identical row_hash set, not doubled', async () => {
    await collectTask(INPUT);
    await collectTask(INPUT);

    expect(state.uploads).toHaveLength(2);
    // Each run uploads exactly the two rows (never 4), with two distinct hashes.
    expect(state.uploads[0]!.rows).toHaveLength(2);
    expect(new Set(hashes(state.uploads[0]!)).size).toBe(2);
    // The hash set is identical across runs → stable, deterministic ids.
    expect(hashes(state.uploads[0]!)).toEqual(hashes(state.uploads[1]!));
    // Both runs replace the SAME (dataset, table, date, type) slice.
    expect(state.slices[0]).toEqual({
      dataset: 'gsc_byProperty',
      table: 'urlp_test',
      date: '2026-01-01',
      type: 'web',
    });
    expect(state.slices[1]).toEqual(state.slices[0]);
  });

  it('overlap: two concurrent runs of the same cell target the same slice + same hashes', async () => {
    await Promise.all([collectTask(INPUT), collectTask(INPUT)]);
    expect(state.uploads).toHaveLength(2);
    expect(hashes(state.uploads[0]!)).toEqual(hashes(state.uploads[1]!));
    expect(state.slices[0]).toEqual(state.slices[1]); // same slice → BigQuery replace dedups
  });

  it('crash: a write that throws pre-ack then retries replaces the slice, never appends', async () => {
    state.failLoadOnce = true;
    await expect(collectTask(INPUT)).rejects.toThrow(/write-then-crash/);
    // Retry succeeds and targets the very same slice as the crashed attempt.
    const result = await collectTask(INPUT);
    expect(result.status).toBe('collected_with_data');
    expect(state.slices).toHaveLength(2); // one crashed delete-then-load + one successful
    expect(state.slices[0]).toEqual(state.slices[1]);
    // The successful retry uploaded exactly the two rows — a replace, not an append.
    const ok = state.uploads[state.uploads.length - 1]!;
    expect(ok.rows).toHaveLength(2);
    expect(new Set(hashes(ok)).size).toBe(2);
  });
});
