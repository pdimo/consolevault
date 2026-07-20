/**
 * Shared dashboard report runner — used by the API (to serve) and the orchestrator (to warm the
 * cache). Resolves a target (property|group) to a BigQuery FROM operand, compiles filters, and runs
 * the report SQL via the warehouse byte-capped query. Keeps the API and the daily precompute in sync.
 */

import {
  autoContentGroups,
  autoTopicClusters,
  brandMatchExpr,
  brandSplitSql,
  brandTimeseriesSql,
  breakdownSql,
  compileFilters,
  comparisonWindow,
  ctrBenchmarkSql,
  ctrCurveSql,
  ctrScatterSql,
  queryPagePairsSql,
  DATASETS,
  fromTable,
  fromUnion,
  groupedMetricsSql,
  groupMatchExpr,
  kpisSql,
  positionBucketsSql,
  strikingDistanceSql,
  timeseriesSql,
  topEntitySql,
  Warehouse,
  type Rollup,
} from '@consolevault/bq';
import type { DashboardFilters, MatchRule } from '@consolevault/types';
import { GroupRepository } from './groups.js';
import { PropertyRepository } from './properties.js';
import { SemanticGroupRepository } from './semantic-groups.js';

export type ReportName =
  | 'kpis'
  | 'timeseries'
  | 'top-queries'
  | 'top-pages'
  | 'breakdown'
  | 'position-buckets'
  | 'ctr-scatter'
  | 'striking-distance'
  | 'movers'
  | 'grouped-entities'
  | 'ctr-benchmark'
  | 'cannibalization'
  | 'content-decay'
  | 'brand-split'
  | 'brand-timeseries';

/** Reports the daily precompute warms (byProperty-only — no extra IAM needed). */
export const PRECOMPUTE_REPORTS: ReportName[] = [
  'kpis',
  'timeseries',
  'top-queries',
  'breakdown',
  'position-buckets',
  'ctr-scatter',
  'striking-distance',
  'movers',
];

function todayPacific(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function parseDashboardFilters(q: Record<string, unknown>): DashboardFilters {
  const csv = (v: unknown) =>
    typeof v === 'string' && v
      ? v
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined;
  const num = (v: unknown) => (v != null && v !== '' ? Number(v) : undefined);
  const end = (q.end as string) || todayPacific();
  let start = (q.start as string) || '';
  if (!start) {
    const range = (q.range as string) || '28d';
    const days = range === '3mo' ? 90 : range === '12mo' ? 365 : 28;
    start = addDays(end, -(days - 1));
  }
  const device = csv(q.device);
  const country = csv(q.country);
  const query = (q.query as string) || undefined;
  const page = (q.page as string) || undefined;
  const positionMin = num(q.positionMin);
  const positionMax = num(q.positionMax);
  const brandExclude = csv(q.brandExclude);
  const brandTerms = csv(q.brandTerms);
  const segment =
    q.segment === 'brand' ? 'brand' : q.segment === 'nonbrand' ? 'nonbrand' : undefined;
  const COMPARE_MODES = ['none', 'previous', 'yoy', 'prev_month', 'custom'] as const;
  const compareMode = COMPARE_MODES.find((m) => m === q.compareMode);
  const presets = (csv(q.presets) ?? []).filter(
    (p): p is 'paa' | 'longtail' => p === 'paa' || p === 'longtail',
  );
  return {
    searchType: (q.searchType as string) || 'web',
    start,
    end,
    finalOnly: q.finalOnly === 'true' || q.finalOnly === '1',
    ...(device ? { device } : {}),
    ...(country ? { country } : {}),
    ...(query ? { query } : {}),
    ...(page ? { page } : {}),
    ...(positionMin !== undefined ? { positionMin } : {}),
    ...(positionMax !== undefined ? { positionMax } : {}),
    ...(brandExclude ? { brandExclude } : {}),
    ...(brandTerms ? { brandTerms } : {}),
    ...(segment ? { segment } : {}),
    ...(compareMode ? { compareMode } : {}),
    ...(q.compareStart ? { compareStart: q.compareStart as string } : {}),
    ...(q.compareEnd ? { compareEnd: q.compareEnd as string } : {}),
    ...(q.matchWeekdays === 'true' || q.matchWeekdays === '1' ? { matchWeekdays: true } : {}),
    ...(presets.length ? { presets } : {}),
  };
}

/** A copy of the filters with the brand segment removed (used where it can't/shouldn't apply). */
function withoutSegment(f: DashboardFilters): DashboardFilters {
  const { segment: _segment, ...rest } = f;
  return rest;
}

/** The comparison window for movers — always needs a baseline, so 'none' falls back to 'previous'. */
function moversWindow(f: DashboardFilters): { start: string; end: string } {
  const mode = !f.compareMode || f.compareMode === 'none' ? 'previous' : f.compareMode;
  return (
    comparisonWindow({ ...f, compareMode: mode }) ??
    comparisonWindow({ ...f, compareMode: 'previous' })!
  );
}

type Row = Record<string, unknown>;
type RunFn = (sql: string, params: Record<string, unknown>) => Promise<Row[]>;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Top entities (query|page) by clicks, each annotated with its prior-period metrics as `prev` when a
 * comparison window applies (so tables can render a value + Δ% chip). One extra query only when a
 * comparison is active; keys absent from the prior period get `prev: null`.
 */
async function topWithPrev(
  run: RunFn,
  from: string,
  eff: DashboardFilters,
  dim: 'query' | 'page',
  limit: number,
): Promise<Row[]> {
  const opts = dim === 'page' ? { requirePage: true } : { requireQuery: true };
  const cur = compileFilters(eff, opts);
  const curRows = await run(topEntitySql(from, cur.where, dim, limit), cur.params);
  const win = comparisonWindow(eff);
  if (!win) return curRows;
  const prev = compileFilters({ ...eff, ...win }, opts);
  const prevRows = await run(topEntitySql(from, prev.where, dim, limit), prev.params);
  const pmap = new Map(prevRows.map((r) => [String(r.key), r]));
  return curRows.map((r) => {
    const p = pmap.get(String(r.key));
    return {
      ...r,
      prev: p
        ? { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position }
        : null,
    };
  });
}

export class DashboardService {
  constructor(
    private readonly warehouse: Warehouse,
    private readonly projectId: string,
    private readonly props = new PropertyRepository(),
    private readonly groups = new GroupRepository(),
    private readonly semanticGroups = new SemanticGroupRepository(),
  ) {}

  private async resolveFrom(type: string, id: string, dataset: string): Promise<string | null> {
    if (type === 'property') {
      const p = await this.props.get(id);
      if (!p) return null;
      return (await this.warehouse.tableExists(dataset, p.sanitizedTableName))
        ? fromTable(this.projectId, dataset, p.sanitizedTableName)
        : null;
    }
    const g = await this.groups.get(id);
    if (!g) return null;
    const members = (await Promise.all(g.memberPropertyIds.map((m) => this.props.get(m)))).filter(
      (m): m is NonNullable<typeof m> => Boolean(m),
    );
    const tables: string[] = [];
    for (const m of members) {
      if (await this.warehouse.tableExists(dataset, m.sanitizedTableName)) {
        tables.push(m.sanitizedTableName);
      }
    }
    return tables.length ? fromUnion(this.projectId, dataset, tables) : null;
  }

  /** Run a report and return its serializable data. */
  async report(
    report: ReportName,
    type: string,
    id: string,
    q: Record<string, unknown>,
  ): Promise<unknown> {
    const filters = parseDashboardFilters(q);
    // Page-dimension reports read byPage, which has no query column.
    const usesPage =
      report === 'top-pages' ||
      report === 'cannibalization' ||
      report === 'content-decay' ||
      (report === 'movers' && q.dim === 'page') ||
      (report === 'grouped-entities' && q.kind === 'content');
    const dataset = usesPage ? DATASETS.byPage : DATASETS.byProperty;
    const from = await this.resolveFrom(type, id, dataset);
    if (!from) return report === 'kpis' ? { current: null, previous: null } : [];
    const run = (sql: string, params: Record<string, unknown>) =>
      this.warehouse.runAnalytics(sql, params);

    // The brand segment classifies on `query`; byPage has no query dimension, so strip it there.
    const eff = usesPage ? withoutSegment(filters) : filters;

    if (report === 'brand-split' || report === 'brand-timeseries') {
      const terms = filters.brandTerms ?? [];
      if (!terms.length) return [];
      const { where, params } = compileFilters(withoutSegment(filters));
      const expr = brandMatchExpr(terms, params);
      if (!expr) return [];
      return report === 'brand-split'
        ? run(brandSplitSql(from, where, expr), params)
        : run(
            brandTimeseriesSql(from, where, expr, ((q.rollup as string) || 'day') as Rollup),
            params,
          );
    }
    if (report === 'kpis') {
      const cur = compileFilters(eff);
      const win = comparisonWindow(eff);
      if (!win) {
        const [current] = await run(kpisSql(from, cur.where), cur.params);
        return { current: current ?? null, previous: null };
      }
      const prev = compileFilters({ ...eff, ...win });
      const [[current], [previous]] = await Promise.all([
        run(kpisSql(from, cur.where), cur.params),
        run(kpisSql(from, prev.where), prev.params),
      ]);
      return { current: current ?? null, previous: previous ?? null };
    }
    if (report === 'timeseries') {
      // `series=compare` returns the same series shifted to the comparison window (for the dashed
      // overlay). Uses the one authoritative comparisonWindow so the overlay matches the KPI deltas.
      let f2 = eff;
      if (q.series === 'compare') {
        const win = comparisonWindow(eff);
        if (!win) return [];
        f2 = { ...eff, ...win };
      }
      const { where, params } = compileFilters(f2);
      return run(timeseriesSql(from, where, ((q.rollup as string) || 'day') as Rollup), params);
    }
    if (report === 'top-queries') {
      return topWithPrev(run, from, eff, 'query', 200);
    }
    if (report === 'top-pages') {
      return topWithPrev(run, from, eff, 'page', 200);
    }
    if (report === 'breakdown') {
      const dim = q.dim === 'country' ? 'country' : 'device';
      const { where, params } = compileFilters(eff);
      return run(breakdownSql(from, where, dim), params);
    }
    if (report === 'position-buckets') {
      const { where, params } = compileFilters(eff);
      return run(positionBucketsSql(from, where), params);
    }
    if (report === 'ctr-scatter') {
      const { where, params } = compileFilters(eff, { requireQuery: true });
      return run(ctrScatterSql(from, where, 500), params);
    }
    if (report === 'striking-distance') {
      // The position range is expressed on the aggregate (weighted) position via HAVING, so strip
      // the row-level position filter from the WHERE and feed the bounds to the SQL builder instead.
      const { positionMin, positionMax, ...rest } = eff;
      const { where, params } = compileFilters(rest, { requireQuery: true });
      return run(
        strikingDistanceSql(from, where, {
          ...(positionMin != null ? { min: positionMin } : {}),
          ...(positionMax != null ? { max: positionMax } : {}),
          limit: 100,
        }),
        params,
      );
    }
    if (report === 'grouped-entities') {
      return this.groupedEntities(
        run,
        from,
        type,
        id,
        eff,
        q.kind === 'content' ? 'content' : 'topic',
      );
    }
    if (report === 'ctr-benchmark') {
      const { where, params } = compileFilters(eff, { requireQuery: true });
      const [curve, rows] = await Promise.all([
        run(ctrCurveSql(from, where), params),
        run(ctrBenchmarkSql(from, where, 200), params),
      ]);
      const bench = new Map(curve.map((c) => [num(c.pos), num(c.ctr)]));
      const enriched = rows.map((r) => {
        const benchmark = bench.get(Math.round(num(r.position))) ?? null;
        return {
          key: String(r.key),
          position: num(r.position),
          ctr: num(r.ctr),
          impressions: num(r.impressions),
          clicks: num(r.clicks),
          benchmark,
          diff: benchmark == null ? null : num(r.ctr) - benchmark,
        };
      });
      return {
        benchmark: curve.map((c) => ({ pos: num(c.pos), ctr: num(c.ctr) })),
        rows: enriched,
      };
    }
    if (report === 'cannibalization') {
      const { where, params } = compileFilters(eff, { requireQuery: true, requirePage: true });
      const minImpr = num(q.minImpressions) || 10;
      const pairs = await run(queryPagePairsSql(from, where, 5000), params);
      const byQuery = new Map<
        string,
        { page: string; clicks: number; impressions: number; position: number }[]
      >();
      for (const r of pairs) {
        const qy = String(r.q);
        let arr = byQuery.get(qy);
        if (!arr) {
          arr = [];
          byQuery.set(qy, arr);
        }
        arr.push({
          page: String(r.p),
          clicks: num(r.clicks),
          impressions: num(r.impressions),
          position: num(r.position),
        });
      }
      return [...byQuery.entries()]
        .map(([key, pages]) => ({
          key,
          pages: pages.length,
          clicks: pages.reduce((s, p) => s + p.clicks, 0),
          impressions: pages.reduce((s, p) => s + p.impressions, 0),
          competing: pages.sort((a, b) => b.impressions - a.impressions).slice(0, 8),
        }))
        .filter((r) => r.pages >= 2 && r.impressions >= minImpr)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 200);
    }
    if (report === 'content-decay') {
      const cur = compileFilters(eff, { requirePage: true });
      const prev = compileFilters({ ...eff, ...moversWindow(eff) }, { requirePage: true });
      const [curRows, prevRows] = await Promise.all([
        run(topEntitySql(from, cur.where, 'page', 500), cur.params),
        run(topEntitySql(from, prev.where, 'page', 500), prev.params),
      ]);
      const prevMap = new Map(prevRows.map((r) => [String(r.key), num(r.clicks)]));
      return curRows
        .map((r) => {
          const key = String(r.key);
          const clicks = num(r.clicks);
          const prevClicks = prevMap.get(key) ?? 0;
          const delta = clicks - prevClicks;
          return {
            key,
            clicks,
            prevClicks,
            delta,
            deltaPct: prevClicks > 0 ? (delta / prevClicks) * 100 : null,
          };
        })
        .filter((r) => r.prevClicks > 0)
        .sort((a, b) => a.delta - b.delta);
    }
    // movers — current vs previous period diffed, for query (default) or page.
    const moversDim: 'query' | 'page' = q.dim === 'page' ? 'page' : 'query';
    const mOpts = moversDim === 'page' ? { requirePage: true } : { requireQuery: true };
    const cur = compileFilters(eff, mOpts);
    const prev = compileFilters({ ...eff, ...moversWindow(eff) }, mOpts);
    const [curRows, prevRows] = await Promise.all([
      run(topEntitySql(from, cur.where, moversDim, 1000), cur.params),
      run(topEntitySql(from, prev.where, moversDim, 1000), prev.params),
    ]);
    const prevMap = new Map(prevRows.map((r) => [String(r.key), Number(r.clicks)]));
    const seen = new Set<string>();
    const movers = curRows.map((r) => {
      const key = String(r.key);
      seen.add(key);
      const clicks = Number(r.clicks);
      const prevClicks = prevMap.get(key) ?? 0;
      return { key, clicks, prevClicks, delta: clicks - prevClicks, isNew: !prevMap.has(key) };
    });
    for (const [key, prevClicks] of prevMap) {
      if (!seen.has(key))
        movers.push({ key, clicks: 0, prevClicks, delta: -prevClicks, isNew: false });
    }
    movers.sort((a, b) => b.delta - a.delta);
    const top = movers.slice(0, 50);
    return [...top, ...movers.slice(-50).filter((m) => !top.includes(m))];
  }

  /**
   * Deterministic group suggestions for the editor's "Generate automatically" — always derived fresh
   * from the property's own top pages/queries over a default 3-month window (ignores saved groups).
   */
  async autoSuggestGroups(
    id: string,
    kind: 'content' | 'topic',
  ): Promise<{ name: string; rules: MatchRule[] }[]> {
    const dim = kind === 'content' ? 'page' : 'query';
    const dataset = kind === 'content' ? DATASETS.byPage : DATASETS.byProperty;
    const from = await this.resolveFrom('property', id, dataset);
    if (!from) return [];
    const prop = await this.props.get(id);
    const brandTerms = prop?.brandTerms ?? [];
    const end = todayPacific();
    const eff: DashboardFilters = { searchType: 'web', start: addDays(end, -89), end, brandTerms };
    const requires = dim === 'page' ? { requirePage: true } : { requireQuery: true };
    const seed = compileFilters(eff, requires);
    const rows = await this.warehouse.runAnalytics(
      topEntitySql(from, seed.where, dim, dim === 'page' ? 500 : 1000),
      seed.params,
    );
    return dim === 'page'
      ? autoContentGroups(
          rows.map((r) => ({ page: String(r.key), impressions: num(r.impressions) })),
        )
      : autoTopicClusters(
          rows.map((r) => ({ query: String(r.key), impressions: num(r.impressions) })),
          { brandTerms },
        );
  }

  /**
   * A property's groups for `kind`: the saved ones, else deterministically auto-derived from the
   * property's own top pages/queries (zero-setup default). Group targets require explicit groups.
   */
  private async resolveGroups(
    run: RunFn,
    from: string,
    type: string,
    id: string,
    eff: DashboardFilters,
    kind: 'content' | 'topic',
  ): Promise<{ name: string; rules: MatchRule[]; priority: boolean }[]> {
    if (type === 'property') {
      const saved = await this.semanticGroups.listForProperty(id, kind);
      if (saved.length)
        return saved.map((g) => ({ name: g.name, rules: g.rules, priority: !!g.priority }));
    }
    if (type !== 'property') return [];
    const dim = kind === 'content' ? 'page' : 'query';
    const requires = dim === 'page' ? { requirePage: true } : { requireQuery: true };
    const seed = compileFilters(eff, requires);
    const rows = await run(
      topEntitySql(from, seed.where, dim, dim === 'page' ? 500 : 1000),
      seed.params,
    );
    const auto =
      dim === 'page'
        ? autoContentGroups(
            rows.map((r) => ({ page: String(r.key), impressions: num(r.impressions) })),
          )
        : autoTopicClusters(
            rows.map((r) => ({ query: String(r.key), impressions: num(r.impressions) })),
            { brandTerms: eff.brandTerms ?? [] },
          );
    return auto.map((g) => ({ name: g.name, rules: g.rules, priority: false }));
  }

  /** Per-group metrics (+ prior-period delta) for the Topic Clusters / Content Groups panels. */
  private async groupedEntities(
    run: RunFn,
    from: string,
    type: string,
    id: string,
    eff: DashboardFilters,
    kind: 'content' | 'topic',
  ): Promise<Row[]> {
    const groups = await this.resolveGroups(run, from, type, id, eff, kind);
    if (!groups.length) return [];
    const requires = kind === 'content' ? { requirePage: true } : { requireQuery: true };
    const build = (winFilters: DashboardFilters) => {
      const { where, params } = compileFilters(winFilters, requires);
      const exprs = groups.map((g, i) => groupMatchExpr(g.rules, params, `gm${i}_`) || 'FALSE');
      return { sql: groupedMetricsSql(from, where, exprs), params };
    };
    const cur = build(eff);
    const win = comparisonWindow(eff);
    const prev = win ? build({ ...eff, ...win }) : null;
    const [[curRow], prevRes] = await Promise.all([
      run(cur.sql, cur.params),
      prev ? run(prev.sql, prev.params) : Promise.resolve([] as Row[]),
    ]);
    const prevRow = prevRes[0];
    return groups
      .map((g, i) => ({
        key: g.name,
        clicks: num(curRow?.[`g${i}_clicks`]),
        impressions: num(curRow?.[`g${i}_impr`]),
        ctr: num(curRow?.[`g${i}_ctr`]),
        position: num(curRow?.[`g${i}_pos`]),
        priority: g.priority,
        rules: g.rules,
        prev: prevRow
          ? {
              clicks: num(prevRow[`g${i}_clicks`]),
              impressions: num(prevRow[`g${i}_impr`]),
              ctr: num(prevRow[`g${i}_ctr`]),
              position: num(prevRow[`g${i}_pos`]),
            }
          : null,
      }))
      .sort((a, b) => b.clicks - a.clicks);
  }
}
