/**
 * Rank-bucket heatmap — the answer to the average-position problem.
 *
 * GSC's `position` is one floating-point average, and it lies whenever the distribution is lopsided:
 * a page ranking 1st for one query and 25th for twenty reports an average near 24, which describes
 * neither outcome. Each row here is one entity's distribution across the rank buckets, with that
 * misleading average kept in view beside it so the two can be compared directly.
 *
 * Cells are shaded on a single-hue sequential ramp (`--accent` mixed toward the surface in five
 * discrete steps, so it stays monotonic in both themes), normalised WITHIN each row — the question
 * a row answers is "where does this rank", not "is this the biggest row". Values are printed in the
 * cell as well as shaded, so the encoding is never colour-alone.
 */

import type { RankHeatmap as RankHeatmapData, RankRow } from '../../api';
import { Table, Td, Th } from '../ui';

/** What the cells count — units, or the impressions/clicks those units earned. */
export type RankWeight = 'count' | 'impressions' | 'clicks';

/** `count` is labelled by what a unit IS, which depends on the dimension. */
export function weightLabel(weight: RankWeight, unit: 'query' | 'day'): string {
  if (weight === 'count') return unit === 'day' ? 'Days' : 'Queries';
  return weight === 'clicks' ? 'Clicks' : 'Impressions';
}

const compact = (n: number) => Intl.NumberFormat('en', { notation: 'compact' }).format(n);

/** Five discrete steps of the sequential ramp; 0 is its own "nothing here" step. */
function step(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const share = value / max;
  if (share > 0.75) return 4;
  if (share > 0.5) return 3;
  if (share > 0.25) return 2;
  return 1;
}

export function RankHeatmap({
  data,
  onPick,
  topN = 20,
}: {
  data: RankHeatmapData;
  /** Click an entity to filter the report by it (same affordance as the movers lists). */
  onPick?: (key: string) => void;
  topN?: number;
}) {
  const rows = data.rows.slice(0, topN);
  if (rows.length === 0) return <p className="py-12 text-center text-sm text-muted">No data.</p>;
  const label = weightLabel(data.weight, data.unit);
  const unit = label.toLowerCase();
  const cell = (r: RankRow, key: string) => Number(r[key] ?? 0);

  return (
    <div className="space-y-3">
      <Table>
        <thead>
          <tr>
            <Th className="sticky left-0 z-10 bg-surface-2">
              {data.unit === 'day' ? 'Query' : 'Page'}
            </Th>
            {data.buckets.map((b) => (
              <Th key={b.key} className="text-center">
                {b.label}
              </Th>
            ))}
            <Th className="text-right">Avg pos.</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const max = Math.max(...data.buckets.map((b) => cell(r, b.key)));
            return (
              <tr key={r.key}>
                <Td className="max-w-[16rem] sticky left-0 z-10 bg-surface">
                  {onPick ? (
                    <button
                      type="button"
                      onClick={() => onPick(r.key)}
                      className="block max-w-full truncate text-left hover:text-accent"
                      title={r.key}
                    >
                      {r.key}
                    </button>
                  ) : (
                    <span className="block max-w-full truncate" title={r.key}>
                      {r.key}
                    </span>
                  )}
                </Td>
                {data.buckets.map((b) => {
                  const v = cell(r, b.key);
                  return (
                    <Td
                      key={b.key}
                      className={`rh rh-${step(v, max)} text-center tabular-nums`}
                      title={`${r.key} — rank ${b.label}: ${Math.round(v).toLocaleString()} ${unit}`}
                    >
                      {v > 0 ? compact(v) : '·'}
                    </Td>
                  );
                })}
                <Td className="text-right tabular-nums text-muted">{r.position.toFixed(1)}</Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span>less</span>
          {[0, 1, 2, 3, 4].map((s) => (
            <i
              key={s}
              className={`rh rh-${s} inline-block h-3 w-3 rounded-sm border border-line`}
            />
          ))}
          <span>more</span>
        </span>
        <span>{label} per rank bucket, shaded within each row.</span>
      </div>
    </div>
  );
}
