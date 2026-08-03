import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { DashboardListItem, SavedFilter } from '@consolevault/types';
import {
  api,
  type BrandSplitRow,
  type BrandTrendPoint,
  type BucketRow,
  type EntityRow,
  type GroupRow,
  type Kpi,
  type MoverRow,
  type ScatterRow,
  type TsPoint,
} from './api';
import {
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  SegmentedControl,
  Select,
  Spinner,
  TextInput,
  Table,
  Td,
  Th,
} from './components/ui';
import { Bubble, StackedArea, TrendArea } from './components/charts';
import { MetricSelector, type Metric } from './components/report/MetricSelector';
import { DateRangeMenu, type CompareMode, type Rollup } from './components/report/DateRangeMenu';
import { FilterChips, type Chip } from './components/report/FilterChips';
import { MetricDelta } from './components/report/delta';
import { BreakdownList } from './components/report/BreakdownList';
import { GroupPanel } from './components/report/GroupPanel';
import { useToast } from './components/feedback';

type Range = '28d' | '3mo' | '12mo';

interface Filters {
  range: Range;
  rollup: Rollup;
  searchType: string;
  start: string;
  end: string;
  device: string;
  country: string;
  query: string;
  page: string;
  positionMin: string;
  positionMax: string;
  brandExclude: string;
  finalOnly: boolean;
  segment: '' | 'brand' | 'nonbrand';
  compareMode: CompareMode;
  matchWeekdays: boolean;
  compareStart: string;
  compareEnd: string;
  presets: string;
}

const METRIC_LABEL: Record<Metric, string> = {
  clicks: 'Clicks',
  impressions: 'Impressions',
  ctr: 'CTR',
  position: 'Avg position',
};
const fmtNum = (v: number) => Math.round(v).toLocaleString();
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPos = (v: number) => v.toFixed(1);

function fmtMetric(m: Metric, v: number | null | undefined): string {
  if (v == null) return '—';
  if (m === 'ctr') return fmtPct(v);
  if (m === 'position') return fmtPos(v);
  return fmtNum(v);
}

function buildQs(f: Filters): string {
  const p = new URLSearchParams({ rollup: f.rollup, searchType: f.searchType });
  // Explicit start/end (from the date menu) take precedence; otherwise fall back to a named range.
  if (f.start && f.end) {
    p.set('start', f.start);
    p.set('end', f.end);
  } else {
    p.set('range', f.range);
  }
  if (f.device) p.set('device', f.device.toUpperCase());
  if (f.country) p.set('country', f.country.toLowerCase());
  if (f.query) p.set('query', f.query);
  if (f.page) p.set('page', f.page);
  if (f.positionMin) p.set('positionMin', f.positionMin);
  if (f.positionMax) p.set('positionMax', f.positionMax);
  if (f.brandExclude) p.set('brandExclude', f.brandExclude);
  if (f.finalOnly) p.set('finalOnly', '1');
  if (f.segment) p.set('segment', f.segment);
  if (f.compareMode && f.compareMode !== 'previous') p.set('compareMode', f.compareMode);
  if (f.matchWeekdays) p.set('matchWeekdays', '1');
  if (f.compareStart) p.set('compareStart', f.compareStart);
  if (f.compareEnd) p.set('compareEnd', f.compareEnd);
  if (f.presets) p.set('presets', f.presets);
  return p.toString();
}

function filtersFromParams(p: URLSearchParams): Filters {
  return {
    range: (p.get('range') as Range) || '28d',
    rollup: (p.get('rollup') as Rollup) || 'day',
    searchType: p.get('searchType') || 'web',
    start: p.get('start') || '',
    end: p.get('end') || '',
    device: p.get('device') || '',
    country: p.get('country') || '',
    query: p.get('query') || '',
    page: p.get('page') || '',
    positionMin: p.get('positionMin') || '',
    positionMax: p.get('positionMax') || '',
    brandExclude: p.get('brandExclude') || '',
    finalOnly: p.get('finalOnly') === '1',
    segment: (p.get('segment') as Filters['segment']) || '',
    compareMode: (p.get('compareMode') as CompareMode) || 'previous',
    matchWeekdays: p.get('matchWeekdays') === '1',
    compareStart: p.get('compareStart') || '',
    compareEnd: p.get('compareEnd') || '',
    presets: p.get('presets') || '',
  };
}

/** Effective start/end for the date menu (derives named-range defaults when not explicitly set). */
function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function effectiveRange(f: Filters): { start: string; end: string } {
  if (f.start && f.end) return { start: f.start, end: f.end };
  const end = new Date();
  const days = f.range === '3mo' ? 90 : f.range === '12mo' ? 365 : 28;
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));
  return { start: ymdLocal(start), end: ymdLocal(end) };
}

type SortKey = 'key' | 'clicks' | 'impressions' | 'ctr' | 'position';
const PAGE_SIZE = 10;

/** Paginated + sortable entity table (queries/pages/striking distance), mobile-safe truncation. */
function EntityTable({
  rows,
  head,
  onPick,
  metric = 'clicks',
}: {
  rows: EntityRow[] | null;
  head: string;
  /** Click-to-filter: narrow the whole report to this row's key. */
  onPick?: (key: string) => void;
  /** The focus metric — gets the Δ chip highlighting change vs the comparison period. */
  metric?: Metric;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'clicks', dir: -1 });
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [rows, sort]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === 'string' || typeof bv === 'string')
        return String(av).localeCompare(String(bv)) * sort.dir;
      return ((av as number) - (bv as number)) * sort.dir;
    });
  }, [rows, sort]);

  if (!rows) return <Spinner className="mx-auto my-8 h-5 w-5" />;
  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted">No data.</p>;

  const start = page * PAGE_SIZE;
  const pageRows = sorted.slice(start, start + PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const onSort = (key: SortKey) =>
    setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }));
  const SortTh = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <Th className={right ? 'text-right' : ''}>
      <button className="inline-flex items-center gap-1 hover:text-fg" onClick={() => onSort(k)}>
        {label}
        {sort.key === k && <span className="text-[10px]">{sort.dir === 1 ? '▲' : '▼'}</span>}
      </button>
    </Th>
  );

  const metricCols: { k: Metric; label: string }[] = [
    { k: 'clicks', label: 'Clicks' },
    { k: 'impressions', label: 'Impr.' },
    { k: 'ctr', label: 'CTR' },
    { k: 'position', label: 'Pos.' },
  ];

  return (
    <div>
      <Table className="rounded-none border-0">
        <thead>
          <tr>
            <SortTh k="key" label={head} />
            {metricCols.map((c) => (
              <SortTh key={c.k} k={c.k} label={c.label} right />
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={r.key} className="hover:bg-surface-2/50">
              <Td>
                {onPick ? (
                  <button
                    type="button"
                    onClick={() => onPick(r.key)}
                    title={`Filter by ${r.key}`}
                    className="max-w-[55vw] truncate text-left text-accent hover:underline sm:max-w-md"
                  >
                    {r.key}
                  </button>
                ) : (
                  <div className="max-w-[55vw] truncate sm:max-w-md" title={r.key}>
                    {r.key}
                  </div>
                )}
              </Td>
              {metricCols.map((c) => (
                <Td key={c.k} className="text-right tabular-nums">
                  <div className="flex flex-col items-end leading-tight">
                    <span>{fmtMetric(c.k, r[c.k])}</span>
                    {r.prev != null && c.k === metric && (
                      <MetricDelta metric={c.k} cur={r[c.k]} prev={r.prev?.[c.k]} size="xs" />
                    )}
                  </div>
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted">
        <span>
          {start + 1}–{Math.min(start + PAGE_SIZE, sorted.length)} of {sorted.length}
        </span>
        <div className="flex gap-1">
          <Button size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <Button size="sm" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ embedded = false }: { embedded?: boolean }) {
  const { type = '', id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);
  const [list, setList] = useState<DashboardListItem[]>([]);
  const [draft, setDraft] = useState<Filters>(filters);
  const [showFilters, setShowFilters] = useState(false);
  const [metric, setMetric] = useState<Metric>('clicks');

  // Filters live in the URL (shareable). `patch` merges keys; empty values are removed.
  const patch = (obj: Record<string, string>) =>
    setParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(obj)) {
          if (v) np.set(k, v);
          else np.delete(k);
        }
        return np;
      },
      { replace: true },
    );
  useEffect(() => setDraft(filters), [params]);

  const dr = effectiveRange(filters);
  // Active dimension filters → removable chips (the visible result of click-to-filter).
  const chips: Chip[] = useMemo(() => {
    const cs: Chip[] = [];
    if (filters.query)
      cs.push({ dim: 'Query', value: filters.query, onClear: () => patch({ query: '' }) });
    if (filters.page)
      cs.push({ dim: 'Page', value: filters.page, onClear: () => patch({ page: '' }) });
    if (filters.country)
      cs.push({ dim: 'Country', value: filters.country, onClear: () => patch({ country: '' }) });
    if (filters.device)
      cs.push({ dim: 'Device', value: filters.device, onClear: () => patch({ device: '' }) });
    if (filters.segment)
      cs.push({ dim: 'Segment', value: filters.segment, onClear: () => patch({ segment: '' }) });
    if (filters.positionMin || filters.positionMax)
      cs.push({
        dim: 'Position',
        value: `${filters.positionMin || '0'}–${filters.positionMax || '∞'}`,
        onClear: () => patch({ positionMin: '', positionMax: '' }),
      });
    if (filters.presets)
      cs.push({ dim: 'Preset', value: filters.presets, onClear: () => patch({ presets: '' }) });
    return cs;
  }, [filters]);
  const clearAllChips = () =>
    patch({
      query: '',
      page: '',
      country: '',
      device: '',
      segment: '',
      positionMin: '',
      positionMax: '',
      presets: '',
    });

  // Quick filters + saved presets.
  const toast = useToast();
  const scope = `${type}:${id}`;
  const [saved, setSaved] = useState<SavedFilter[]>([]);
  const reloadSaved = () =>
    api
      .listSavedFilters(scope)
      .then(setSaved)
      .catch(() => undefined);
  useEffect(() => {
    api
      .listSavedFilters(scope)
      .then(setSaved)
      .catch(() => setSaved([]));
  }, [scope]);
  const activePresets = new Set(
    (filters.presets ? filters.presets.split(',') : []).filter(Boolean),
  );
  const togglePreset = (p: 'paa' | 'longtail') => {
    const set = new Set(activePresets);
    if (set.has(p)) set.delete(p);
    else set.add(p);
    patch({ presets: [...set].join(',') });
  };
  const saveCurrent = async () => {
    const name = window.prompt('Save current filters as:')?.trim();
    if (!name) return;
    const p: Record<string, string> = {};
    for (const k of [
      'searchType',
      'query',
      'page',
      'country',
      'device',
      'segment',
      'positionMin',
      'positionMax',
      'brandExclude',
      'presets',
    ]) {
      const v = params.get(k);
      if (v) p[k] = v;
    }
    try {
      await api.createSavedFilter(scope, name, p);
      await reloadSaved();
      toast('Filter saved', 'success');
    } catch {
      toast('Could not save filter', 'error');
    }
  };
  const removeSaved = async (fid: string) => {
    try {
      await api.deleteSavedFilter(fid);
      await reloadSaved();
    } catch {
      toast('Delete failed', 'error');
    }
  };

  const [kpis, setKpis] = useState<{ current: Kpi | null; previous: Kpi | null } | null>(null);
  const [ts, setTs] = useState<TsPoint[] | null>(null);
  const [tsCompare, setTsCompare] = useState<TsPoint[] | null>(null);
  const [topQ, setTopQ] = useState<EntityRow[] | null>(null);
  const [topP, setTopP] = useState<EntityRow[] | null>(null);
  const [device, setDevice] = useState<EntityRow[] | null>(null);
  const [country, setCountry] = useState<EntityRow[] | null>(null);
  const [buckets, setBuckets] = useState<BucketRow[] | null>(null);
  const [scatter, setScatter] = useState<ScatterRow[] | null>(null);
  const [movers, setMovers] = useState<MoverRow[] | null>(null);
  const [moversPages, setMoversPages] = useState<MoverRow[] | null>(null);
  const [moversDim, setMoversDim] = useState<'query' | 'page'>('query');
  const [topicGroups, setTopicGroups] = useState<GroupRow[] | null>(null);
  const [contentGroups, setContentGroups] = useState<GroupRow[] | null>(null);
  const [brandSplit, setBrandSplit] = useState<BrandSplitRow[] | null>(null);
  const [brandTrend, setBrandTrend] = useState<BrandTrendPoint[] | null>(null);

  useEffect(() => {
    api
      .listClients()
      .then(setList)
      .catch(() => undefined);
  }, []);

  const brandTerms = useMemo(
    () => list.find((d) => d.type === type && d.id === id)?.brandTerms ?? [],
    [list, type, id],
  );
  const hasBrand = brandTerms.length > 0;

  // Brand terms are target config (not a user filter) but must reach the API + cache key.
  const qs = useMemo(() => {
    const base = buildQs(filters);
    if (!hasBrand) return base;
    const p = new URLSearchParams(base);
    p.set('brandTerms', brandTerms.join(','));
    return p.toString();
  }, [filters, brandTerms, hasBrand]);

  useEffect(() => {
    // Guard against stale responses: a slower request from a previous (type/id/qs) must not
    // overwrite state belonging to the current one. `ignore` flips on cleanup, and every setter
    // is wrapped so late resolutions become no-ops.
    let ignore = false;
    const g =
      <T,>(setter: (v: T) => void) =>
      (v: T) => {
        if (!ignore) setter(v);
      };
    setKpis(null);
    setTs(null);
    setTsCompare(null);
    setTopQ(null);
    setTopP(null);
    setDevice(null);
    setCountry(null);
    setBuckets(null);
    setScatter(null);
    setMovers(null);
    setMoversPages(null);
    setTopicGroups(null);
    setContentGroups(null);
    setBrandSplit(null);
    setBrandTrend(null);
    const r = <T,>(report: string, extra = '') =>
      api.dashboardReport<T>(type, id, report, qs + extra);
    api
      .dashboardKpis(type, id, qs)
      .then(g(setKpis))
      .catch(() => g(setKpis)({ current: null, previous: null }));
    api
      .dashboardTimeseries(type, id, qs)
      .then(g(setTs))
      .catch(() => g(setTs)([]));
    if (filters.compareMode !== 'none') {
      r<TsPoint[]>('timeseries', '&series=compare')
        .then(g(setTsCompare))
        .catch(() => g(setTsCompare)([]));
    } else {
      setTsCompare([]);
    }
    r<EntityRow[]>('top-queries')
      .then(g(setTopQ))
      .catch(() => g(setTopQ)([]));
    r<EntityRow[]>('top-pages')
      .then(g(setTopP))
      .catch(() => g(setTopP)([]));
    r<EntityRow[]>('breakdown', '&dim=device')
      .then(g(setDevice))
      .catch(() => g(setDevice)([]));
    r<EntityRow[]>('breakdown', '&dim=country')
      .then(g(setCountry))
      .catch(() => g(setCountry)([]));
    r<BucketRow[]>('position-buckets')
      .then(g(setBuckets))
      .catch(() => g(setBuckets)([]));
    r<ScatterRow[]>('ctr-scatter')
      .then(g(setScatter))
      .catch(() => g(setScatter)([]));
    r<MoverRow[]>('movers')
      .then(g(setMovers))
      .catch(() => g(setMovers)([]));
    r<MoverRow[]>('movers', '&dim=page')
      .then(g(setMoversPages))
      .catch(() => g(setMoversPages)([]));
    r<GroupRow[]>('grouped-entities', '&kind=topic')
      .then(g(setTopicGroups))
      .catch(() => g(setTopicGroups)([]));
    r<GroupRow[]>('grouped-entities', '&kind=content')
      .then(g(setContentGroups))
      .catch(() => g(setContentGroups)([]));
    if (hasBrand) {
      r<BrandSplitRow[]>('brand-split')
        .then(g(setBrandSplit))
        .catch(() => g(setBrandSplit)([]));
      r<BrandTrendPoint[]>('brand-timeseries')
        .then(g(setBrandTrend))
        .catch(() => g(setBrandTrend)([]));
    }
    return () => {
      ignore = true;
    };
  }, [type, id, qs, hasBrand, filters.compareMode]);

  const current = kpis?.current;
  const previous = kpis?.previous;
  const name = list.find((d) => d.type === type && d.id === id)?.name ?? id;

  const mval = (d: TsPoint) => (metric === 'ctr' ? d.ctr * 100 : d[metric]);
  // Overlay the comparison series aligned by index onto the current period's dates (the windows
  // have equal length; the dashed line reads as "same day-offset, prior period").
  const trend = useMemo(() => {
    const cur = (ts ?? []).map((d) => ({ date: d.date, value: mval(d) }));
    const cmp = tsCompare ?? [];
    if (!cmp.length) return cur;
    return cur.map((row, i) => {
      const c = cmp[i];
      return c ? { ...row, compare: mval(c) } : row;
    });
  }, [ts, tsCompare, metric]);
  const hasCompare = (tsCompare?.length ?? 0) > 0;
  const bubble = useMemo(
    () =>
      (scatter ?? []).map((s) => ({
        x: s.position,
        y: s.ctr * 100,
        z: s.impressions,
        name: s.key,
      })),
    [scatter],
  );
  const moversRows = (moversDim === 'page' ? moversPages : movers) ?? null;
  // Click a cluster/group → filter the whole report by its first rule (regex rules aren't filterable).
  const pickGroup = (g: GroupRow) => {
    const rule = g.rules?.[0];
    if (!rule || rule.op === 'regex') return;
    patch(rule.dimension === 'page' ? { page: rule.value } : { query: rule.value });
  };
  const gainers = (moversRows ?? []).filter((m) => m.delta > 0).slice(0, 15);
  const losers = (moversRows ?? []).filter((m) => m.delta < 0).slice(0, 15);

  const brandRow = brandSplit?.find((r) => r.segment === 'brand') ?? null;
  const nonbrandRow = brandSplit?.find((r) => r.segment === 'nonbrand') ?? null;
  const brandClicks = brandRow?.clicks ?? 0;
  const nonbrandClicks = nonbrandRow?.clicks ?? 0;
  const brandShare =
    brandClicks + nonbrandClicks ? (brandClicks / (brandClicks + nonbrandClicks)) * 100 : 0;
  const brandCmp = [
    { label: 'Clicks', b: fmtNum(brandClicks), n: fmtNum(nonbrandClicks) },
    {
      label: 'Impressions',
      b: fmtNum(brandRow?.impressions ?? 0),
      n: fmtNum(nonbrandRow?.impressions ?? 0),
    },
    { label: 'CTR', b: fmtPct(brandRow?.ctr ?? 0), n: fmtPct(nonbrandRow?.ctr ?? 0) },
    {
      label: 'Avg position',
      b: fmtPos(brandRow?.position ?? 0),
      n: fmtPos(nonbrandRow?.position ?? 0),
    },
  ];

  return (
    <div>
      {!embedded && (
        <PageHeader
          title="Dashboard"
          description={name}
          actions={
            <Select
              value={`${type}:${id}`}
              onChange={(e) => {
                const [t, i] = e.target.value.split(':');
                navigate(`/clients/${t}/${i}/report`);
              }}
            >
              {list.map((d) => (
                <option key={`${d.type}:${d.id}`} value={`${d.type}:${d.id}`}>
                  {d.name}
                </option>
              ))}
            </Select>
          }
        />
      )}

      {/* Report toolbar: metric + search-type + brand segment + date/compare menu + mode + filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <MetricSelector value={metric} onChange={setMetric} />
        {hasBrand && (
          <SegmentedControl<'all' | 'brand' | 'nonbrand'>
            value={filters.segment || 'all'}
            onChange={(s) => patch({ segment: s === 'all' ? '' : s })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'brand', label: 'Brand' },
              { value: 'nonbrand', label: 'Non-brand' },
            ]}
          />
        )}
        <span className="flex-1" />
        <DateRangeMenu
          value={{
            start: dr.start,
            end: dr.end,
            rollup: filters.rollup,
            compareMode: filters.compareMode,
            matchWeekdays: filters.matchWeekdays,
            compareStart: filters.compareStart,
            compareEnd: filters.compareEnd,
          }}
          onChange={patch}
        />
        <Button onClick={() => setShowFilters((s) => !s)}>
          {showFilters ? 'Hide filters' : 'Filters'}
        </Button>
      </div>

      <FilterChips chips={chips} onClearAll={clearAllChips} />

      {showFilters && (
        <Card className="mb-5">
          {/* Quick filters: position presets, query presets, saved filters. Apply immediately. */}
          <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-line pb-4">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Quick</span>
            <Button size="sm" onClick={() => patch({ positionMin: '1', positionMax: '10' })}>
              Top 10
            </Button>
            <Button size="sm" onClick={() => patch({ positionMin: '11', positionMax: '20' })}>
              Top 20
            </Button>
            <span className="mx-1 h-4 w-px bg-line" />
            <Button
              size="sm"
              variant={activePresets.has('paa') ? 'primary' : 'secondary'}
              onClick={() => togglePreset('paa')}
            >
              People also ask
            </Button>
            <Button
              size="sm"
              variant={activePresets.has('longtail') ? 'primary' : 'secondary'}
              onClick={() => togglePreset('longtail')}
            >
              Long tail
            </Button>
            <span className="flex-1" />
            {saved.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => patch(f.params)}>
                  {f.name}
                </Button>
                <button
                  type="button"
                  aria-label={`Delete ${f.name}`}
                  onClick={() => removeSaved(f.id)}
                  className="text-muted hover:text-bad"
                >
                  ×
                </button>
              </span>
            ))}
            <Button size="sm" onClick={saveCurrent}>
              Save current
            </Button>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Search type">
              <Select
                value={draft.searchType}
                onChange={(e) => setDraft((d) => ({ ...d, searchType: e.target.value }))}
              >
                {['web', 'image', 'video', 'news', 'discover', 'googleNews'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Device (comma list)">
              <TextInput
                placeholder="MOBILE, DESKTOP"
                value={draft.device}
                onChange={(e) => setDraft((d) => ({ ...d, device: e.target.value }))}
              />
            </Field>
            <Field label="Country (ISO, comma list)">
              <TextInput
                placeholder="aus, nzl"
                value={draft.country}
                onChange={(e) => setDraft((d) => ({ ...d, country: e.target.value }))}
              />
            </Field>
            <Field label="Query contains (comma list)">
              <TextInput
                value={draft.query}
                onChange={(e) => setDraft((d) => ({ ...d, query: e.target.value }))}
              />
            </Field>
            <Field label="Page contains (comma list)">
              <TextInput
                value={draft.page}
                onChange={(e) => setDraft((d) => ({ ...d, page: e.target.value }))}
              />
            </Field>
            <Field label="Brand exclude (comma list)">
              <TextInput
                value={draft.brandExclude}
                onChange={(e) => setDraft((d) => ({ ...d, brandExclude: e.target.value }))}
              />
            </Field>
            <div className="flex gap-3">
              <Field label="Pos. min">
                <TextInput
                  type="number"
                  className="w-20"
                  value={draft.positionMin}
                  onChange={(e) => setDraft((d) => ({ ...d, positionMin: e.target.value }))}
                />
              </Field>
              <Field label="Pos. max">
                <TextInput
                  type="number"
                  className="w-20"
                  value={draft.positionMax}
                  onChange={(e) => setDraft((d) => ({ ...d, positionMax: e.target.value }))}
                />
              </Field>
            </div>
            <label className="flex items-end gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={draft.finalOnly}
                onChange={(e) => setDraft((d) => ({ ...d, finalOnly: e.target.checked }))}
              />
              Final data only
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <Button
              variant="primary"
              onClick={() =>
                patch({
                  searchType: draft.searchType,
                  device: draft.device,
                  country: draft.country,
                  query: draft.query,
                  page: draft.page,
                  positionMin: draft.positionMin,
                  positionMax: draft.positionMax,
                  brandExclude: draft.brandExclude,
                  finalOnly: draft.finalOnly ? '1' : '',
                })
              }
            >
              Apply filters
            </Button>
            <Button
              onClick={() =>
                patch({
                  searchType: 'web',
                  device: '',
                  country: '',
                  query: '',
                  page: '',
                  positionMin: '',
                  positionMax: '',
                  brandExclude: '',
                  finalOnly: '',
                })
              }
            >
              Clear
            </Button>
          </div>
        </Card>
      )}

      {/* KPI cards (click to switch the trend metric) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(['clicks', 'impressions', 'ctr', 'position'] as Metric[]).map((m) => (
          <button key={m} onClick={() => setMetric(m)} className="text-left">
            <div
              className={
                'rounded-xl border bg-surface p-4 shadow-sm transition-colors ' +
                (metric === m ? 'border-accent' : 'border-line hover:border-accent/50')
              }
            >
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {METRIC_LABEL[m]}
              </p>
              <p className="mt-1 text-2xl font-semibold">
                {kpis ? fmtMetric(m, current?.[m]) : <span className="text-muted">…</span>}
              </p>
              <p className="mt-1 flex items-center gap-1.5">
                <MetricDelta metric={m} cur={current?.[m]} prev={previous?.[m]} />
                <span className="text-xs text-muted">vs prev</span>
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Plain-language "what changed" summary — useful in any review, client or analyst. */}
      {current && previous && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2/40 px-4 py-3 text-sm">
          <span className="font-medium">{METRIC_LABEL[metric]}</span>{' '}
          {(() => {
            const c = metric === 'ctr' ? (current.ctr ?? 0) : (current[metric] ?? 0);
            const p = metric === 'ctr' ? (previous.ctr ?? 0) : (previous[metric] ?? 0);
            if (!p) return <>has no comparison baseline yet.</>;
            const pct = ((c - p) / Math.abs(p)) * 100;
            const steady = Math.abs(pct) < 0.05;
            const better = metric === 'position' ? pct < 0 : pct > 0;
            return (
              <>
                {steady ? 'held steady' : better ? 'improved' : 'declined'}{' '}
                <span className={better ? 'font-medium text-ok' : 'font-medium text-bad'}>
                  {Math.abs(pct).toFixed(1)}%
                </span>{' '}
                vs the comparison period.
              </>
            );
          })()}{' '}
          {gainers.length + losers.length > 0 && (
            <span className="text-muted">
              {gainers.length} {moversDim === 'page' ? 'pages' : 'queries'} gained, {losers.length}{' '}
              declined.
            </span>
          )}
        </div>
      )}

      <Card className="mt-5" title={`${METRIC_LABEL[metric]} over time`}>
        {!ts ? (
          <div className="grid place-items-center py-16 text-muted">
            <Spinner className="h-6 w-6" />
          </div>
        ) : ts.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">No data for this period.</p>
        ) : (
          <TrendArea
            data={trend}
            xKey="date"
            height={280}
            series={[
              { key: 'value', name: METRIC_LABEL[metric], color: 'var(--accent)' },
              ...(hasCompare
                ? [{ key: 'compare', name: 'Comparison', color: 'var(--muted)', dashed: true }]
                : []),
            ]}
          />
        )}
      </Card>

      {/* Brand vs non-brand split */}
      {hasBrand && (
        <Card
          className="mt-5"
          title="Brand vs non-brand"
          actions={<Badge tone="accent">{brandShare.toFixed(0)}% brand clicks</Badge>}
        >
          {!brandSplit ? (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner className="h-6 w-6" />
            </div>
          ) : brandSplit.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">No data for this period.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 text-muted">
                      <th className="px-3 py-2 text-left font-medium">Metric</th>
                      <th className="px-3 py-2 text-right font-medium">Brand</th>
                      <th className="px-3 py-2 text-right font-medium">Non-brand</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandCmp.map((row) => (
                      <tr key={row.label} className="border-t border-line">
                        <td className="px-3 py-2 text-muted">{row.label}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.b}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{row.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
                  Clicks over time
                </p>
                {brandTrend && brandTrend.length > 0 ? (
                  <StackedArea
                    data={brandTrend as unknown as Record<string, unknown>[]}
                    xKey="date"
                    height={200}
                    series={[
                      { key: 'brand', name: 'Brand', color: 'var(--accent)' },
                      { key: 'nonbrand', name: 'Non-brand', color: 'var(--muted)' },
                    ]}
                  />
                ) : (
                  <div className="grid place-items-center py-16 text-muted">
                    <Spinner className="h-5 w-5" />
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Topic clusters + Content groups — auto-derived when none are saved; click to filter. */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Topic clusters">
          <GroupPanel rows={topicGroups} metric={metric} onPick={pickGroup} />
        </Card>
        <Card title="Content groups">
          <GroupPanel rows={contentGroups} metric={metric} onPick={pickGroup} />
        </Card>
      </div>

      {/* Top queries / pages */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Top queries" bodyClassName="p-0">
          <EntityTable
            rows={topQ}
            head="Query"
            metric={metric}
            onPick={(key) => patch({ query: key })}
          />
        </Card>
        <Card title="Top pages" bodyClassName="p-0">
          <EntityTable
            rows={topP}
            head="Page"
            metric={metric}
            onPick={(key) => patch({ page: key })}
          />
        </Card>
      </div>

      {/* Device / country — these FOLLOW the selected metric. */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`${METRIC_LABEL[metric]} by device`}>
          {!device ? (
            <Spinner className="mx-auto my-12 h-6 w-6" />
          ) : (
            <BreakdownList rows={device} metric={metric} />
          )}
        </Card>
        <Card title={`${METRIC_LABEL[metric]} by country`}>
          {!country ? (
            <Spinner className="mx-auto my-12 h-6 w-6" />
          ) : (
            <BreakdownList rows={country} metric={metric} />
          )}
        </Card>
      </div>

      {/* Diagnostics — fixed analytical views (impression volume + CTR/position), independent of the
          metric selector by design; labelled so that's clear. */}
      <div className="mt-8 mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Diagnostics</h2>
        <span className="h-px flex-1 bg-line" />
        <span className="hidden text-xs text-muted sm:inline">
          independent of the selected metric
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Impressions by ranking tier">
          {!buckets ? (
            <Spinner className="mx-auto my-12 h-6 w-6" />
          ) : buckets.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">No data.</p>
          ) : (
            <StackedArea
              data={buckets as unknown as Record<string, unknown>[]}
              xKey="date"
              series={[
                { key: 'top3', name: '1–3', color: 'var(--ok)' },
                { key: 'p4_10', name: '4–10', color: 'var(--fresh)' },
                { key: 'p11_20', name: '11–20', color: 'var(--accent)' },
                { key: 'p21_50', name: '21–50', color: 'var(--warn)' },
                { key: 'p50plus', name: '50+', color: 'var(--bad)' },
              ]}
            />
          )}
        </Card>
        <Card title="CTR vs position (bubble = impressions)">
          {!scatter ? (
            <Spinner className="mx-auto my-12 h-6 w-6" />
          ) : scatter.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">No data.</p>
          ) : (
            <Bubble data={bubble} xLabel="Position" yLabel="CTR" yPercent />
          )}
        </Card>
      </div>

      {/* Movers — the key "what changed" insight (queries + pages), click any to filter. */}
      <div className="mt-5">
        <Card
          title="Movers"
          actions={
            <SegmentedControl<'query' | 'page'>
              value={moversDim}
              onChange={setMoversDim}
              options={[
                { value: 'query', label: 'Queries' },
                { value: 'page', label: 'Pages' },
              ]}
            />
          }
        >
          {!moversRows ? (
            <Spinner className="mx-auto my-12 h-6 w-6" />
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <MoverList
                title="Gainers"
                tone="ok"
                rows={gainers}
                onPick={(key) => patch(moversDim === 'page' ? { page: key } : { query: key })}
              />
              <MoverList
                title="Losers"
                tone="bad"
                rows={losers}
                onPick={(key) => patch(moversDim === 'page' ? { page: key } : { query: key })}
              />
            </div>
          )}
        </Card>
      </div>

      {/* Opportunities — surfaced inline so a client review flows straight into the actions. */}
      <div className="mt-8 mb-3 flex items-center gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Opportunities</h2>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            slug: 'striking-distance',
            label: 'Striking distance',
            hook: 'Queries just off page one',
          },
          { slug: 'ctr-benchmark', label: 'CTR benchmark', hook: 'Under-performing click-through' },
          { slug: 'cannibalization', label: 'Cannibalization', hook: 'Pages competing for a term' },
          { slug: 'content-decay', label: 'Content decay', hook: 'Pages losing traffic' },
        ].map((o) => (
          <Link
            key={o.slug}
            to={`/clients/${type}/${id}/opportunities?report=${o.slug}`}
            className="group rounded-xl border border-line bg-surface p-4 transition-colors hover:border-accent/50"
          >
            <p className="font-medium text-fg">{o.label}</p>
            <p className="mt-0.5 text-sm text-muted">{o.hook}</p>
            <p className="mt-2 text-sm text-accent group-hover:underline">View →</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

/** One side of the movers panel (gainers or losers). Rows are click-to-filter. */
function MoverList({
  title,
  tone,
  rows,
  onPick,
}: {
  title: string;
  tone: 'ok' | 'bad';
  rows: MoverRow[];
  onPick: (key: string) => void;
}) {
  const color = tone === 'ok' ? 'text-ok' : 'text-bad';
  return (
    <div>
      <p className={`mb-1 text-sm font-semibold ${color}`}>{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">None.</p>
      ) : (
        rows.map((m) => (
          <div
            key={m.key}
            className="flex items-center justify-between gap-2 border-b border-line py-1 text-sm"
          >
            <button
              type="button"
              onClick={() => onPick(m.key)}
              title={`Filter by ${m.key}`}
              className="min-w-0 truncate text-left text-accent hover:underline"
            >
              {m.key}
            </button>
            <span className={`flex shrink-0 items-center gap-1 tabular-nums ${color}`}>
              {m.delta > 0 ? '+' : ''}
              {fmtNum(m.delta)}
              {m.isNew && <Badge tone="accent">new</Badge>}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
