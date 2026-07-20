/**
 * Dimension breakdown that FOLLOWS the selected metric (device / country). A horizontal bar list
 * works for every metric — unlike a clicks-donut — so switching the top metric selector updates it
 * coherently. Bars are "longer = better": counts/CTR scale with value; Position is inverted (a lower
 * average position ranks higher, so it gets the longer bar).
 */

import type { Metric } from './MetricSelector';

interface BreakdownRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

function fmt(metric: Metric, v: number): string {
  if (metric === 'ctr') return `${(v * 100).toFixed(1)}%`;
  if (metric === 'position') return v.toFixed(1);
  return Math.round(v).toLocaleString();
}

export function BreakdownList({
  rows,
  metric,
  topN = 8,
}: {
  rows: BreakdownRow[] | null;
  metric: Metric;
  topN?: number;
}) {
  const list = (rows ?? []).filter((r) => r.key);
  list.sort((a, b) => (metric === 'position' ? a[metric] - b[metric] : b[metric] - a[metric]));
  const top = list.slice(0, topN);
  const max = Math.max(...top.map((r) => Math.abs(r[metric])), 1);

  if (top.length === 0) return <p className="py-8 text-center text-sm text-muted">No data.</p>;
  return (
    <div className="flex flex-col gap-1.5">
      {top.map((r) => {
        const frac = Math.abs(r[metric]) / max;
        const width = metric === 'position' ? 1 - frac : frac; // lower position → longer bar
        return (
          <div key={r.key} className="flex items-center gap-2 text-sm">
            <span className="w-20 shrink-0 truncate text-muted sm:w-28" title={r.key}>
              {r.key || '(none)'}
            </span>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-2">
              <div
                className="absolute inset-y-0 left-0 rounded bg-accent/70"
                style={{ width: `${Math.max(2, width * 100)}%` }}
              />
            </div>
            <span className="w-16 shrink-0 text-right tabular-nums">{fmt(metric, r[metric])}</span>
          </div>
        );
      })}
    </div>
  );
}
