/**
 * Icon metric selector (ref `metric selector.png`) — the primary metric drives the trend chart and
 * which column the entity tables emphasise. Compact, icon-first, keyboard-focusable.
 */

export type Metric = 'clicks' | 'impressions' | 'ctr' | 'position';

const METRICS: { key: Metric; label: string; icon: string }[] = [
  { key: 'clicks', label: 'Clicks', icon: '👆' },
  { key: 'impressions', label: 'Impressions', icon: '👁' },
  { key: 'ctr', label: 'CTR', icon: '％' },
  { key: 'position', label: 'Position', icon: '＃' },
];

export function MetricSelector({
  value,
  onChange,
}: {
  value: Metric;
  onChange: (m: Metric) => void;
}) {
  return (
    <div
      className="inline-flex rounded-lg border border-line bg-surface p-0.5"
      role="tablist"
      aria-label="Metric"
    >
      {METRICS.map((m) => (
        <button
          key={m.key}
          type="button"
          role="tab"
          aria-selected={value === m.key}
          title={m.label}
          onClick={() => onChange(m.key)}
          className={
            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors ' +
            (value === m.key ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')
          }
        >
          <span aria-hidden className="text-xs">
            {m.icon}
          </span>
          <span className="hidden sm:inline">{m.label}</span>
        </button>
      ))}
    </div>
  );
}
