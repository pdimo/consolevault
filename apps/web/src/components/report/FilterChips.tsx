/**
 * Active-filter chips (ref `filtering.png`) — the visible result of universal click-to-filter. Each
 * chip clears its own filter; "Clear all" resets them together. Purely presentational; the dashboard
 * owns the filter state (URL params) and supplies the clear callbacks.
 */

export interface Chip {
  /** e.g. "Query" — the dimension. */
  dim: string;
  /** e.g. "mackay goodwin" — the value. */
  value: string;
  onClear: () => void;
}

export function FilterChips({ chips, onClearAll }: { chips: Chip[]; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {chips.map((c, i) => (
        <span
          key={`${c.dim}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 py-1 pl-2.5 pr-1 text-sm"
        >
          <span className="text-muted">{c.dim}</span>
          <span className="max-w-[16rem] truncate font-medium text-fg">{c.value}</span>
          <button
            type="button"
            aria-label={`Remove ${c.dim} filter`}
            onClick={c.onClear}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-full text-muted hover:bg-line hover:text-fg"
          >
            ×
          </button>
        </span>
      ))}
      <button type="button" onClick={onClearAll} className="text-sm text-accent hover:underline">
        Clear all
      </button>
    </div>
  );
}
