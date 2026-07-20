/**
 * Topic Clusters / Content Groups panel (ref the SEOGets group lists). Shows each group as a relative
 * bar of the selected metric with a comparison Δ pill and a ★ for priority groups, tabbed All /
 * Growing / Decaying (by the selected metric's change). Rows are click-to-filter. Auto-populated by
 * the deterministic auto-grouping when the property has no saved groups.
 */

import { useState } from 'react';
import type { GroupRow } from '../../api';
import { Spinner } from '../ui';
import { MetricDelta } from './delta';
import type { Metric } from './MetricSelector';

function fmt(metric: Metric, v: number): string {
  if (metric === 'ctr') return `${(v * 100).toFixed(1)}%`;
  if (metric === 'position') return v.toFixed(1);
  return Math.round(v).toLocaleString();
}
const mval = (
  metric: Metric,
  r: { clicks: number; impressions: number; ctr: number; position: number },
) => (metric === 'ctr' ? r.ctr : r[metric]);

export function GroupPanel({
  rows,
  metric,
  onPick,
}: {
  rows: GroupRow[] | null;
  metric: Metric;
  /** Click-to-filter: narrow the whole report to this group (maps its first rule to a query/page filter). */
  onPick: (g: GroupRow) => void;
}) {
  const [tab, setTab] = useState<'all' | 'growing' | 'decaying'>('all');
  if (!rows) return <Spinner className="mx-auto my-10 h-6 w-6" />;
  if (rows.length === 0)
    return <p className="py-8 text-center text-sm text-muted">No groups yet.</p>;

  const change = (r: GroupRow): number | null => {
    const p = r.prev ? mval(metric, r.prev) : null;
    if (p == null || p === 0) return null;
    return ((mval(metric, r) - p) / Math.abs(p)) * 100;
  };
  const better = (c: number) => (metric === 'position' ? c < 0 : c > 0);

  let list = [...rows];
  if (tab !== 'all')
    list = list.filter((r) => {
      const c = change(r);
      return c != null && (tab === 'growing' ? better(c) : !better(c));
    });
  list.sort((a, b) =>
    metric === 'position' ? mval(metric, a) - mval(metric, b) : mval(metric, b) - mval(metric, a),
  );
  const max = Math.max(...list.map((r) => Math.abs(mval(metric, r))), 1);

  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg border border-line p-0.5 text-sm">
        {(['all', 'growing', 'decaying'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              'rounded-md px-2.5 py-1 capitalize ' +
              (tab === t ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')
            }
          >
            {t}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">Nothing {tab}.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map((r) => {
            const frac = Math.abs(mval(metric, r)) / max;
            const width = metric === 'position' ? 1 - frac : frac;
            return (
              <button
                key={r.key}
                type="button"
                onClick={() => onPick(r)}
                title={`Filter by ${r.key}`}
                className="flex items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-surface-2"
              >
                <span className="flex w-28 shrink-0 items-center gap-1 truncate sm:w-40">
                  {r.priority && <span className="text-warn">★</span>}
                  <span className="truncate">{r.key}</span>
                </span>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-surface-2">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-accent/70"
                    style={{ width: `${Math.max(2, width * 100)}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right tabular-nums">
                  {fmt(metric, mval(metric, r))}
                </span>
                <span className="w-16 shrink-0 text-right">
                  <MetricDelta
                    metric={metric}
                    cur={mval(metric, r)}
                    prev={r.prev ? mval(metric, r.prev) : null}
                    size="xs"
                  />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
