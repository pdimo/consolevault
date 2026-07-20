/**
 * Opportunities — actionable SEO reports on dedicated pages, with sub-navigation so the four report
 * types share one flow (and deep-link from the dashboard via ?target=&report=). All four —
 * Striking Distance, CTR Benchmark, Keyword Cannibalization and Content Decay — are live and share
 * the same tab bar. Each report leads with plain-language explainer cards, then the data.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DashboardListItem } from '@consolevault/types';
import { api, type EntityRow } from './api';
import {
  Card,
  PageHeader,
  SegmentedControl,
  Select,
  Spinner,
  Table,
  Td,
  TextInput,
  Th,
} from './components/ui';
import { Explainer } from './components/report/Explainer';

type Range = '28d' | '3mo' | '12mo';
const fmtNum = (v: number) => Math.round(v).toLocaleString();
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtPos = (v: number) => v.toFixed(1);

const OPP_REPORTS = [
  { slug: 'striking-distance', label: 'Striking distance' },
  { slug: 'ctr-benchmark', label: 'CTR benchmark' },
  { slug: 'cannibalization', label: 'Keyword cannibalization' },
  { slug: 'content-decay', label: 'Content decay' },
] as const;

export default function Opportunities() {
  const [params, setParams] = useSearchParams();
  const report = params.get('report') || 'striking-distance';
  const [list, setList] = useState<DashboardListItem[]>([]);
  const target = params.get('target') || (list[0] ? `${list[0].type}:${list[0].id}` : '');

  useEffect(() => {
    api
      .listDashboards()
      .then(setList)
      .catch(() => undefined);
  }, []);

  const setParam = (k: string, v: string) =>
    setParams(
      (prev) => {
        const np = new URLSearchParams(prev);
        if (v) np.set(k, v);
        else np.delete(k);
        return np;
      },
      { replace: true },
    );

  const active = OPP_REPORTS.find((r) => r.slug === report) ?? OPP_REPORTS[0];

  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="Prioritised, actionable reports — where a small effort yields outsized gains."
        actions={
          <Select value={target} onChange={(e) => setParam('target', e.target.value)}>
            {list.map((d) => (
              <option key={`${d.type}:${d.id}`} value={`${d.type}:${d.id}`}>
                {d.name}
              </option>
            ))}
          </Select>
        }
      />

      {/* Sub-nav across the opportunity reports. */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {OPP_REPORTS.map((r) => (
          <button
            key={r.slug}
            type="button"
            onClick={() => setParam('report', r.slug)}
            className={
              'relative -mb-px rounded-t-lg px-3 py-2 text-sm font-medium transition-colors ' +
              (r.slug === active.slug
                ? 'border-x border-t border-line bg-surface text-fg'
                : 'text-muted hover:text-fg')
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {active.slug === 'striking-distance' ? (
        <StrikingDistance target={target} list={list} />
      ) : active.slug === 'ctr-benchmark' ? (
        <CtrBenchmark target={target} list={list} />
      ) : active.slug === 'cannibalization' ? (
        <Cannibalization target={target} list={list} />
      ) : (
        <ContentDecay target={target} list={list} />
      )}
    </div>
  );
}

/** Shared: resolve a target's brand terms + build a base query string for a report fetch. */
function useTargetQs(
  target: string,
  list: DashboardListItem[],
  range: Range,
  extra: Record<string, string> = {},
) {
  return useMemo(() => {
    const [type, id] = target.split(':');
    if (!type || !id) return null;
    const brandTerms = list.find((d) => d.type === type && d.id === id)?.brandTerms ?? [];
    const p = new URLSearchParams({ range, searchType: 'web', ...extra });
    if (brandTerms.length) p.set('brandTerms', brandTerms.join(','));
    return { type, id, qs: p.toString() };
  }, [target, list, range, JSON.stringify(extra)]);
}

function RangeControl({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  return (
    <div className="mb-4">
      <SegmentedControl<Range>
        value={range}
        onChange={setRange}
        options={[
          { value: '28d', label: '28 days' },
          { value: '3mo', label: '3 months' },
          { value: '12mo', label: '12 months' },
        ]}
      />
    </div>
  );
}

interface CtrBenchmarkResult {
  benchmark: { pos: number; ctr: number }[];
  rows: {
    key: string;
    position: number;
    ctr: number;
    impressions: number;
    clicks: number;
    benchmark: number | null;
    diff: number | null;
  }[];
}

function CtrBenchmark({ target, list }: { target: string; list: DashboardListItem[] }) {
  const [range, setRange] = useState<Range>('3mo');
  const [data, setData] = useState<CtrBenchmarkResult | null>(null);
  const q = useTargetQs(target, list, range);
  useEffect(() => {
    if (!q) return;
    setData(null);
    api
      .dashboardReport<CtrBenchmarkResult>(q.type, q.id, 'ctr-benchmark', q.qs)
      .then(setData)
      .catch(() => setData({ benchmark: [], rows: [] }));
  }, [q]);
  const maxCtr = Math.max(...(data?.benchmark ?? []).map((b) => b.ctr), 0.01);
  return (
    <div>
      <Explainer
        items={[
          {
            title: 'How it works',
            body: 'We compute your site’s average CTR at each of the top 10 positions, then compare every top-10 query against the benchmark for its position. A negative gap means the query earns fewer clicks than its ranking should.',
          },
          {
            title: 'What to do about it',
            body: 'Rewrite the title tag and meta description of under-performers (negative gap, high impressions) to be more compelling and match intent — you can win more clicks without moving up the rankings.',
          },
        ]}
      />
      <RangeControl range={range} setRange={setRange} />
      {!data ? (
        <Spinner className="mx-auto my-12 h-6 w-6" />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
          <Card title="Benchmark by position">
            <div className="flex flex-col gap-1.5">
              {data.benchmark.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No data.</p>
              ) : (
                data.benchmark.map((b) => (
                  <div key={b.pos} className="flex items-center gap-2 text-sm">
                    <span className="w-6 shrink-0 text-muted">#{b.pos}</span>
                    <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-2">
                      <div
                        className="absolute inset-y-0 left-0 rounded bg-accent/70"
                        style={{ width: `${Math.max(2, (b.ctr / maxCtr) * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-right tabular-nums">{fmtPct(b.ctr)}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
          <Card bodyClassName="p-0">
            <Table className="rounded-none border-0">
              <thead>
                <tr>
                  <Th>Query</Th>
                  <Th className="text-right">Impr.</Th>
                  <Th className="text-right">Position</Th>
                  <Th className="text-right">CTR</Th>
                  <Th className="text-right">Benchmark</Th>
                  <Th className="text-right">Gap</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className="hover:bg-surface-2/50">
                    <Td>
                      <div className="max-w-[40vw] truncate sm:max-w-sm" title={r.key}>
                        {r.key}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">{fmtNum(r.impressions)}</Td>
                    <Td className="text-right tabular-nums">{fmtPos(r.position)}</Td>
                    <Td className="text-right tabular-nums">{fmtPct(r.ctr)}</Td>
                    <Td className="text-right tabular-nums text-muted">
                      {r.benchmark == null ? '—' : fmtPct(r.benchmark)}
                    </Td>
                    <Td
                      className={
                        'text-right font-medium tabular-nums ' +
                        (r.diff == null ? 'text-muted' : r.diff < 0 ? 'text-bad' : 'text-ok')
                      }
                    >
                      {r.diff == null ? '—' : `${r.diff >= 0 ? '+' : ''}${fmtPct(r.diff)}`}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>
      )}
    </div>
  );
}

interface CannibalRow {
  key: string;
  pages: number;
  clicks: number;
  impressions: number;
  competing: { page: string; clicks: number; impressions: number; position: number }[];
}

function Cannibalization({ target, list }: { target: string; list: DashboardListItem[] }) {
  const [range, setRange] = useState<Range>('3mo');
  const [rows, setRows] = useState<CannibalRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const q = useTargetQs(target, list, range);
  useEffect(() => {
    if (!q) return;
    setRows(null);
    api
      .dashboardReport<CannibalRow[]>(q.type, q.id, 'cannibalization', q.qs)
      .then(setRows)
      .catch(() => setRows([]));
  }, [q]);
  return (
    <div>
      <Explainer
        items={[
          {
            title: 'How it works',
            body: 'Queries where two or more of your pages rank — they compete with each other, splitting authority and confusing Google about which page to show.',
          },
          {
            title: 'What to do about it',
            body: 'Pick one primary page per query. Consolidate thin duplicates, differentiate intent where both should exist, and point internal links (with matching anchor text) at the page you want to win.',
          },
        ]}
      />
      <RangeControl range={range} setRange={setRange} />
      <Card bodyClassName="p-0">
        {!rows ? (
          <Spinner className="mx-auto my-12 h-6 w-6" />
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">No cannibalization detected.</p>
        ) : (
          <Table className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Query</Th>
                <Th className="text-right">Pages</Th>
                <Th className="text-right">Clicks</Th>
                <Th className="text-right">Impr.</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RowGroup
                  key={r.key}
                  row={r}
                  open={open === r.key}
                  onToggle={() => setOpen(open === r.key ? null : r.key)}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function RowGroup({
  row,
  open,
  onToggle,
}: {
  row: CannibalRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-surface-2/50" onClick={onToggle}>
        <Td>
          <span className="mr-1 text-muted">{open ? '▾' : '▸'}</span>
          <span className="font-medium">{row.key}</span>
        </Td>
        <Td className="text-right tabular-nums">{row.pages}</Td>
        <Td className="text-right tabular-nums">{fmtNum(row.clicks)}</Td>
        <Td className="text-right tabular-nums">{fmtNum(row.impressions)}</Td>
      </tr>
      {open &&
        row.competing.map((c) => (
          <tr key={c.page} className="bg-surface-2/30 text-sm">
            <Td>
              <div className="max-w-[50vw] truncate pl-5 text-muted sm:max-w-lg" title={c.page}>
                {c.page}
              </div>
            </Td>
            <Td className="text-right tabular-nums text-muted">pos {fmtPos(c.position)}</Td>
            <Td className="text-right tabular-nums">{fmtNum(c.clicks)}</Td>
            <Td className="text-right tabular-nums">{fmtNum(c.impressions)}</Td>
          </tr>
        ))}
    </>
  );
}

interface DecayRow {
  key: string;
  clicks: number;
  prevClicks: number;
  delta: number;
  deltaPct: number | null;
}

function ContentDecay({ target, list }: { target: string; list: DashboardListItem[] }) {
  const [range, setRange] = useState<Range>('3mo');
  const [minDrop, setMinDrop] = useState(20); // % decline threshold
  const [rows, setRows] = useState<DecayRow[] | null>(null);
  const q = useTargetQs(target, list, range);
  useEffect(() => {
    if (!q) return;
    setRows(null);
    api
      .dashboardReport<DecayRow[]>(q.type, q.id, 'content-decay', q.qs)
      .then(setRows)
      .catch(() => setRows([]));
  }, [q]);
  const decaying = (rows ?? []).filter((r) => r.deltaPct != null && r.deltaPct <= -minDrop);
  return (
    <div>
      <Explainer
        items={[
          {
            title: 'How it works',
            body: 'Pages whose clicks have fallen versus the previous period of equal length — a sign the content is going stale or losing ground to competitors.',
          },
          {
            title: 'What to do about it',
            body: 'Refresh and re-publish: update facts and dates, expand coverage to match current intent, improve internal linking, and re-promote. Prioritise pages that recently earned real traffic.',
          },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <RangeControl range={range} setRange={setRange} />
        <span className="text-sm text-muted">Min. decline</span>
        <TextInput
          type="number"
          className="w-20"
          value={String(minDrop)}
          onChange={(e) => setMinDrop(Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="text-muted">%</span>
      </div>
      <Card bodyClassName="p-0">
        {!rows ? (
          <Spinner className="mx-auto my-12 h-6 w-6" />
        ) : decaying.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            No pages declining by ≥ {minDrop}%.
          </p>
        ) : (
          <Table className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Page</Th>
                <Th className="text-right">Clicks now</Th>
                <Th className="text-right">Prior</Th>
                <Th className="text-right">Change</Th>
                <Th className="text-right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {decaying.map((r) => (
                <tr key={r.key} className="hover:bg-surface-2/50">
                  <Td>
                    <div className="max-w-[45vw] truncate sm:max-w-md" title={r.key}>
                      {r.key}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{fmtNum(r.clicks)}</Td>
                  <Td className="text-right tabular-nums text-muted">{fmtNum(r.prevClicks)}</Td>
                  <Td className="text-right font-medium tabular-nums text-bad">
                    {r.deltaPct == null ? '—' : `${r.deltaPct.toFixed(0)}%`}
                  </Td>
                  <Td className="text-right">
                    <span className="rounded bg-bad/12 px-1.5 py-0.5 text-xs font-medium text-bad">
                      Decaying
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function StrikingDistance({ target, list }: { target: string; list: DashboardListItem[] }) {
  const [range, setRange] = useState<Range>('3mo');
  const [posMin, setPosMin] = useState('11');
  const [posMax, setPosMax] = useState('20');
  const [rows, setRows] = useState<EntityRow[] | null>(null);

  const brandTerms = useMemo(() => {
    const [type, id] = target.split(':');
    return list.find((d) => d.type === type && d.id === id)?.brandTerms ?? [];
  }, [list, target]);

  useEffect(() => {
    const [type, id] = target.split(':');
    if (!type || !id) return;
    const p = new URLSearchParams({
      range,
      searchType: 'web',
      positionMin: posMin || '11',
      positionMax: posMax || '20',
    });
    if (brandTerms.length) p.set('brandTerms', brandTerms.join(','));
    setRows(null);
    api
      .dashboardReport<EntityRow[]>(type, id, 'striking-distance', p.toString())
      .then(setRows)
      .catch(() => setRows([]));
  }, [target, range, posMin, posMax, brandTerms]);

  return (
    <div>
      <Explainer
        items={[
          {
            title: 'How it works',
            body: 'Queries whose average position sits in the range below (page two by default, 11–20). They already rank — they just need a nudge onto page one.',
          },
          {
            title: 'What to do about it',
            body: 'Strengthen the ranking page: improve the title & intro, add depth and internal links, cover related sub-topics. Prioritise high-impression rows — the biggest upside.',
          },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl<Range>
          value={range}
          onChange={setRange}
          options={[
            { value: '28d', label: '28 days' },
            { value: '3mo', label: '3 months' },
            { value: '12mo', label: '12 months' },
          ]}
        />
        <span className="text-sm text-muted">Position range</span>
        <TextInput
          type="number"
          className="w-20"
          value={posMin}
          onChange={(e) => setPosMin(e.target.value)}
        />
        <span className="text-muted">–</span>
        <TextInput
          type="number"
          className="w-20"
          value={posMax}
          onChange={(e) => setPosMax(e.target.value)}
        />
      </div>
      <Card bodyClassName="p-0">
        {!rows ? (
          <Spinner className="mx-auto my-12 h-6 w-6" />
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">
            No striking-distance queries in this range.
          </p>
        ) : (
          <Table className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Query</Th>
                <Th className="text-right">Impressions</Th>
                <Th className="text-right">Clicks</Th>
                <Th className="text-right">CTR</Th>
                <Th className="text-right">Position</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-surface-2/50">
                  <Td>
                    <div className="max-w-[55vw] truncate sm:max-w-lg" title={r.key}>
                      {r.key}
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">{fmtNum(r.impressions)}</Td>
                  <Td className="text-right tabular-nums">{fmtNum(r.clicks)}</Td>
                  <Td className="text-right tabular-nums">{fmtPct(r.ctr)}</Td>
                  <Td className="text-right font-medium tabular-nums text-warn">
                    {fmtPos(r.position)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
