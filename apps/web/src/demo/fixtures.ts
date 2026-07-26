/**
 * Self-contained demo/sample data. Lets a freshly-deployed user (or someone evaluating the repo)
 * see a fully-populated report before connecting Search Console or collecting anything. No backend,
 * no BigQuery — the api layer short-circuits to these fixtures for the synthetic `sample` client
 * when demo mode is on (Settings toggle or `?demo=1`). Deterministic so it's stable across renders.
 */

import type { DashboardListItem, Property } from '@consolevault/types';
import type {
  BrandSplitRow,
  BrandTrendPoint,
  BucketRow,
  Coverage,
  EntityRow,
  Kpi,
  MoverRow,
  ScatterRow,
  TsPoint,
} from '../api';

export const DEMO_ID = 'sample';
export const DEMO_KEY = 'cv_demo';

export function isDemoOn(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('demo')) {
      localStorage.setItem(DEMO_KEY, '1');
    }
    return localStorage.getItem(DEMO_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDemo(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEMO_KEY, '1');
    else localStorage.removeItem(DEMO_KEY);
  } catch {
    /* ignore */
  }
}

export const demoClient: DashboardListItem = {
  type: 'property',
  id: DEMO_ID,
  name: 'sample-agency.com (demo)',
  brandTerms: ['sample-agency', 'sampleagency'],
};

export const demoProperty: Property = {
  id: DEMO_ID,
  siteUrl: 'https://www.sample-agency.com/',
  propertyType: 'url_prefix',
  sanitizedTableName: 'demo_sample',
  included: true,
  accountIds: ['demo-account'],
  config: {
    types: ['web'],
    aggregations: ['byProperty', 'byPage'],
    offsetDays: 3,
    backfillMonths: 16,
  },
  brandTerms: ['sample-agency', 'sampleagency'],
  status: {
    lastCollectedDate: isoDaysAgo(3),
    dataState: 'fresh',
    lastCollectedAt: new Date(0).toISOString(),
  },
  dashboardEnabled: true,
};

// --- deterministic helpers ---------------------------------------------------
function seeded(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
function isoDaysAgo(n: number): string {
  const d = new Date(Date.UTC(2026, 6, 20));
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
const DAYS = 90;
const kpi = (clicks: number, impressions: number, position: number): Kpi => ({
  clicks,
  impressions,
  ctr: impressions ? clicks / impressions : 0,
  position,
});

// --- series ------------------------------------------------------------------
export function demoTimeseries(): TsPoint[] {
  const rnd = seeded(7);
  return Array.from({ length: DAYS }, (_, i) => {
    const base = 240 + Math.sin(i / 6) * 60 + i * 1.4;
    const clicks = Math.round(base + rnd() * 60);
    const impressions = Math.round(clicks * (18 + rnd() * 6));
    return { date: isoDaysAgo(DAYS - 1 - i), ...kpi(clicks, impressions, 12 + rnd() * 3) };
  });
}

export function demoKpis(): { current: Kpi | null; previous: Kpi | null } {
  const ts = demoTimeseries();
  const sum = (rows: TsPoint[]): Kpi => {
    const clicks = rows.reduce((a, r) => a + r.clicks, 0);
    const impressions = rows.reduce((a, r) => a + r.impressions, 0);
    const position = rows.reduce((a, r) => a + r.position, 0) / (rows.length || 1);
    return kpi(clicks, impressions, Number(position.toFixed(1)));
  };
  return { current: sum(ts.slice(45)), previous: sum(ts.slice(0, 45)) };
}

const QUERIES = [
  'sample agency',
  'seo reporting tool',
  'search console bigquery',
  'gsc api export',
  'keyword tracking software',
  'backlink audit',
  'content decay analysis',
  'striking distance keywords',
  'sample-agency pricing',
  'local seo services',
  'technical seo checklist',
  'rank tracker',
  'ctr benchmark by position',
  'keyword cannibalization fix',
  'topic clusters seo',
];
const PAGES = [
  '/',
  '/pricing/',
  '/blog/gsc-bigquery/',
  '/features/reporting/',
  '/blog/striking-distance/',
  '/about/',
  '/blog/content-decay/',
  '/contact/',
  '/docs/getting-started/',
  '/blog/ctr-benchmarks/',
  '/features/opportunities/',
  '/blog/cannibalization/',
  '/case-studies/',
  '/integrations/looker/',
  '/blog/topic-clusters/',
];

function entityRows(keys: string[], seed: number): EntityRow[] {
  const rnd = seeded(seed);
  return keys
    .map((key, i) => {
      const clicks = Math.round(900 / (i + 1) + rnd() * 60);
      const prevClicks = Math.round(clicks * (0.8 + rnd() * 0.5));
      const impressions = Math.round(clicks * (14 + rnd() * 10));
      return {
        key,
        ...kpi(clicks, impressions, 3 + i * 0.7 + rnd()),
        prev: kpi(prevClicks, Math.round(impressions * 0.95), 3 + i * 0.7 + rnd() + 0.3),
      };
    })
    .sort((a, b) => b.clicks - a.clicks);
}

export function demoTopQueries(): EntityRow[] {
  return entityRows(QUERIES, 11);
}
export function demoTopPages(): EntityRow[] {
  return entityRows(PAGES, 23);
}
export function demoBreakdown(dim: string): EntityRow[] {
  const keys =
    dim === 'country'
      ? ['United States', 'United Kingdom', 'Australia', 'Canada', 'India', 'Germany']
      : ['DESKTOP', 'MOBILE', 'TABLET'];
  return entityRows(keys, dim === 'country' ? 31 : 37).map((r, i) => ({
    ...r,
    key: keys[i] ?? r.key,
  }));
}

export function demoBuckets(): BucketRow[] {
  const rnd = seeded(41);
  return Array.from({ length: DAYS }, (_, i) => ({
    date: isoDaysAgo(DAYS - 1 - i),
    top3: Math.round(30 + rnd() * 10),
    p4_10: Math.round(60 + rnd() * 15),
    p11_20: Math.round(80 + rnd() * 20),
    p21_50: Math.round(120 + rnd() * 30),
    p50plus: Math.round(200 + rnd() * 40),
  }));
}

export function demoScatter(): ScatterRow[] {
  const rnd = seeded(53);
  return [...QUERIES, ...PAGES].slice(0, 30).map((key) => {
    const position = 1 + rnd() * 30;
    const ctr = Math.max(0.005, 0.35 / position + (rnd() - 0.5) * 0.03);
    const impressions = Math.round(300 + rnd() * 4000);
    return {
      key,
      position: Number(position.toFixed(1)),
      ctr,
      impressions,
      clicks: Math.round(impressions * ctr),
    };
  });
}

export function demoMovers(dim?: string): MoverRow[] {
  const keys = dim === 'page' ? PAGES : QUERIES;
  const rnd = seeded(dim === 'page' ? 67 : 61);
  return keys
    .map((key, i) => {
      const prevClicks = Math.round(200 / (i + 1) + rnd() * 40);
      const delta = Math.round((rnd() - 0.45) * 160);
      return {
        key,
        clicks: Math.max(0, prevClicks + delta),
        prevClicks,
        delta,
        isNew: i > 12 && delta > 0,
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export function demoBrandSplit(): BrandSplitRow[] {
  return [
    { segment: 'brand', ...kpi(4200, 61000, 2.4) },
    { segment: 'nonbrand', ...kpi(9100, 402000, 14.8) },
  ];
}
export function demoBrandTimeseries(): BrandTrendPoint[] {
  const rnd = seeded(83);
  return Array.from({ length: DAYS }, (_, i) => {
    const brand = Math.round(120 + rnd() * 40);
    const nonbrand = Math.round(260 + Math.sin(i / 7) * 60 + rnd() * 50);
    return {
      date: isoDaysAgo(DAYS - 1 - i),
      brand,
      nonbrand,
      brandImpr: brand * 15,
      nonbrandImpr: nonbrand * 40,
    };
  });
}

export function demoGrouped(kind: string): Array<EntityRow & { priority?: boolean }> {
  const groups =
    kind === 'content'
      ? ['Blog', 'Product pages', 'Docs', 'Home & about']
      : ['Brand', 'Reporting', 'Opportunities', 'Integrations'];
  return entityRows(groups, kind === 'content' ? 91 : 97).map((r, i) => ({
    ...r,
    priority: i === 0,
  }));
}

export function demoStriking(): EntityRow[] {
  const rnd = seeded(103);
  return QUERIES.slice(0, 10)
    .map((key) => {
      const impressions = Math.round(2000 + rnd() * 6000);
      const position = 11 + rnd() * 9;
      const clicks = Math.round(impressions * (0.02 + rnd() * 0.02));
      return { key: `${key} near-miss`, ...kpi(clicks, impressions, Number(position.toFixed(1))) };
    })
    .sort((a, b) => b.impressions - a.impressions);
}

export function demoCoverage(): Coverage {
  const states = [
    'collected_with_data',
    'collected_with_data',
    'collected_no_data',
    'collected_fresh',
  ];
  const rnd = seeded(127);
  const mkDays = () =>
    Array.from({ length: 120 }, (_, i) => ({
      date: isoDaysAgo(120 - i),
      state: states[Math.floor(rnd() * states.length)] ?? 'collected_with_data',
    }));
  return {
    window: { oldest: isoDaysAgo(120), newest: isoDaysAgo(3) },
    freshness: isoDaysAgo(3),
    cells: [
      { aggregation: 'byProperty', searchType: 'web', days: mkDays() },
      { aggregation: 'byPage', searchType: 'web', days: mkDays() },
    ],
  };
}

/** Report dispatcher used by api.dashboardReport when the target is the demo client. */
export function demoReport(report: string, qs: string): unknown {
  const params = new URLSearchParams(qs);
  switch (report) {
    case 'top-queries':
      return demoTopQueries();
    case 'top-pages':
      return demoTopPages();
    case 'breakdown':
      return demoBreakdown(params.get('dim') ?? 'device');
    case 'position-buckets':
      return demoBuckets();
    case 'ctr-scatter':
      return demoScatter();
    case 'movers':
      return demoMovers(params.get('dim') ?? undefined);
    case 'brand-split':
      return demoBrandSplit();
    case 'brand-timeseries':
      return demoBrandTimeseries();
    case 'grouped-entities':
      return demoGrouped(params.get('kind') ?? 'content');
    case 'striking-distance':
      return demoStriking();
    default:
      return [];
  }
}
