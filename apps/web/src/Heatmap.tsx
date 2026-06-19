import type { CoverageCell } from './api';

const LEGEND: [string, string][] = [
  ['collected_with_data', 'final'],
  ['collected_fresh', 'fresh (refining)'],
  ['collected_no_data', 'no data'],
  ['pending', 'pending'],
  ['queued', 'queued'],
  ['error', 'error'],
  ['skipped', 'n/a (unsupported)'],
  ['not_planned', 'not planned'],
];

export function Heatmap({ cells }: { cells: CoverageCell[] }) {
  return (
    <div>
      <div className="space-y-2">
        {cells.map((c) => (
          <div className="flex items-center gap-3" key={`${c.searchType}|${c.aggregation}`}>
            <div className="w-36 shrink-0 text-xs text-muted">
              {c.searchType} / {c.aggregation}
            </div>
            <div className="flex flex-wrap gap-0.5">
              {c.days.map((d) => (
                <div key={d.date} className={`hm ${d.state}`} title={`${d.date}: ${d.state}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
        {LEGEND.map(([s, label]) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <i className={`hm ${s} inline-block`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
