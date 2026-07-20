/**
 * Comparison delta pill — the single, intuitive "how did this change vs the comparison period"
 * signal used across KPI cards and tables. A tinted rounded pill (green up / red down) with an arrow,
 * so it reads at a glance and stays colourblind-safe (arrow + sign, not colour alone). Direction is
 * metric-aware: for Position, a lower number is an improvement.
 */

import type { Metric } from './MetricSelector';

function fmtPct(pct: number): string {
  const a = Math.abs(pct);
  return `${a >= 10 ? a.toFixed(0) : a.toFixed(1)}%`;
}

export function MetricDelta({
  metric,
  cur,
  prev,
  size = 'sm',
}: {
  metric: Metric;
  cur: number | null | undefined;
  prev: number | null | undefined;
  size?: 'sm' | 'xs';
}) {
  const pad = size === 'xs' ? 'px-1 py-px text-[10px]' : 'px-1.5 py-0.5 text-xs';
  const base = `inline-flex items-center gap-0.5 rounded font-medium tabular-nums ${pad}`;
  if (cur == null || prev == null) return null;
  if (prev === 0) {
    if (cur > 0 && (metric === 'clicks' || metric === 'impressions'))
      return <span className={`${base} bg-accent/12 text-accent`}>new</span>;
    return null;
  }
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.05) return <span className={`${base} bg-surface-2 text-muted`}>±0%</span>;
  const up = pct > 0;
  // Position is inverted: moving to a lower number (up the SERP) is the improvement.
  const good = metric === 'position' ? !up : up;
  return (
    <span className={`${base} ${good ? 'bg-ok/12 text-ok' : 'bg-bad/12 text-bad'}`}>
      {up ? '▲' : '▼'} {fmtPct(pct)}
    </span>
  );
}
