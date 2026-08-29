/**
 * Share of branded search — how much of a target's demand is people typing the brand.
 *
 * Deliberately a TREND, not a headline percentage. A single "38% brand" number is unreadable on its
 * own: what counts as high depends entirely on the site, and the interesting thing is always which
 * way it is moving. So the headline is the change in share across the period (in percentage points)
 * and the primary chart is share over time; the absolute volumes and the metric table sit under it
 * as supporting detail.
 *
 * The direction is shown NEUTRALLY (no green/red). Rising brand share can mean brand demand grew or
 * that non-brand rankings decayed — the widget reports the movement and leaves the reading to the
 * person, who has the context to tell those apart.
 */

import { useMemo } from 'react';
import type { BrandSplitRow, BrandTrendPoint } from '../../api';
import { Card, Spinner } from '../ui';
import { TrendArea, StackedArea } from '../charts';

const fmtNum = (v: number) => Math.round(v).toLocaleString();
const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPos = (v: number) => v.toFixed(1);
const fmtShare = (v: number | null) => (v == null ? '—' : `${v.toFixed(1)}%`);

interface SharePoint {
  date: string;
  /** Brand share of clicks, 0–100. Null on a bucket with no clicks at all (undefined, not zero). */
  share: number | null;
  /** Brand share of impressions, 0–100. */
  shareImpr: number | null;
}

const pct = (part: number, total: number): number | null =>
  total > 0 ? (part / total) * 100 : null;

/**
 * Mean share over the first/last quarter of the period (min one bucket). Comparing edge *windows*
 * rather than the first and last bucket keeps the headline from swinging on one quiet Sunday.
 */
function edgeMean(points: SharePoint[], edge: 'head' | 'tail'): number | null {
  if (!points.length) return null;
  const window = Math.max(1, Math.round(points.length / 4));
  const slice = edge === 'head' ? points.slice(0, window) : points.slice(-window);
  const vals = slice.map((p) => p.share).filter((v): v is number => v != null);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export function BrandShare({
  split,
  trend,
  className = '',
}: {
  split: BrandSplitRow[] | null;
  trend: BrandTrendPoint[] | null;
  className?: string;
}) {
  const points = useMemo<SharePoint[]>(
    () =>
      (trend ?? []).map((p) => ({
        date: p.date,
        share: pct(p.brand, p.brand + p.nonbrand),
        shareImpr: pct(p.brandImpr, p.brandImpr + p.nonbrandImpr),
      })),
    [trend],
  );

  const brandRow = split?.find((r) => r.segment === 'brand') ?? null;
  const nonbrandRow = split?.find((r) => r.segment === 'nonbrand') ?? null;
  const brandClicks = brandRow?.clicks ?? 0;
  const nonbrandClicks = nonbrandRow?.clicks ?? 0;
  const periodShare = pct(brandClicks, brandClicks + nonbrandClicks);

  const start = edgeMean(points, 'head');
  const end = edgeMean(points, 'tail');
  // Percentage POINTS, not a percentage change — "brand share went from 31% to 34%" is +3.0 pts.
  const deltaPts = start != null && end != null ? end - start : null;

  const rows = [
    {
      label: 'Share of clicks',
      b: fmtShare(periodShare),
      n: fmtShare(periodShare == null ? null : 100 - periodShare),
    },
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
    <Card className={className} title="Share of branded search">
      {!split ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : split.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">No data for this period.</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {deltaPts == null ? (
              <span className="text-2xl font-semibold tabular-nums">{fmtShare(periodShare)}</span>
            ) : (
              <>
                <span className="text-2xl font-semibold tabular-nums">
                  {deltaPts >= 0 ? '▲' : '▼'} {Math.abs(deltaPts).toFixed(1)} pts
                </span>
                <span className="text-sm text-muted">
                  brand share of clicks, {fmtShare(start)} → {fmtShare(end)} across the period
                </span>
              </>
            )}
          </div>

          {points.length > 0 ? (
            <TrendArea
              data={points as unknown as Record<string, unknown>[]}
              xKey="date"
              height={220}
              yPercent
              yDomain={[0, 100]}
              legend
              series={[
                { key: 'share', name: 'Brand share of clicks', color: 'var(--accent)' },
                {
                  key: 'shareImpr',
                  name: 'Brand share of impressions',
                  color: 'var(--muted)',
                  dashed: true,
                },
              ]}
            />
          ) : (
            <div className="grid place-items-center py-16 text-muted">
              <Spinner className="h-5 w-5" />
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
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
                  {rows.map((row) => (
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
              {trend && trend.length > 0 ? (
                <StackedArea
                  data={trend as unknown as Record<string, unknown>[]}
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
        </>
      )}
    </Card>
  );
}
