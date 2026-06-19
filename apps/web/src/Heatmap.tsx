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
      {cells.map((c) => (
        <div className="heatmap-row" key={`${c.searchType}|${c.aggregation}`}>
          <div className="label">
            {c.searchType} / {c.aggregation}
          </div>
          <div className="heatmap-grid">
            {c.days.map((d) => (
              <div key={d.date} className={`cell ${d.state}`} title={`${d.date}: ${d.state}`} />
            ))}
          </div>
        </div>
      ))}
      <div className="legend">
        {LEGEND.map(([s, label]) => (
          <span key={s}>
            <i className={`cell ${s}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
