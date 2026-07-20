/**
 * Unified date-range + comparison menu (ref `menu example.png`). Presets compute an explicit
 * start/end (backend honours start/end over `range`), plus rollup granularity and the comparison
 * period that drives KPI deltas + the dashed trend overlay. Emits URL-param patches via `onChange`
 * (empty string clears a param, matching the dashboard's `patch()` semantics).
 */

import { useEffect, useRef, useState } from 'react';

export type CompareMode = 'none' | 'previous' | 'yoy' | 'prev_month' | 'custom';
export type Rollup = 'day' | 'week' | 'month';

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function monthRange(offset: number): { start: string; end: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const last = new Date(now.getFullYear(), now.getMonth() + offset + 1, 0);
  return { start: ymd(first), end: ymd(offset === 0 ? now : last) };
}

const PRESETS: { label: string; range: () => { start: string; end: string } }[] = [
  { label: '7 days', range: () => ({ start: ymd(daysAgo(6)), end: ymd(new Date()) }) },
  { label: '14 days', range: () => ({ start: ymd(daysAgo(13)), end: ymd(new Date()) }) },
  { label: '28 days', range: () => ({ start: ymd(daysAgo(27)), end: ymd(new Date()) }) },
  { label: 'This month', range: () => monthRange(0) },
  { label: 'Last month', range: () => monthRange(-1) },
  { label: '3 months', range: () => ({ start: ymd(daysAgo(89)), end: ymd(new Date()) }) },
  { label: '6 months', range: () => ({ start: ymd(daysAgo(179)), end: ymd(new Date()) }) },
  { label: '12 months', range: () => ({ start: ymd(daysAgo(364)), end: ymd(new Date()) }) },
  { label: '16 months', range: () => ({ start: ymd(daysAgo(486)), end: ymd(new Date()) }) },
];

const COMPARE: { value: CompareMode; label: string }[] = [
  { value: 'none', label: 'Disabled' },
  { value: 'previous', label: 'Previous period' },
  { value: 'yoy', label: 'Year over year' },
  { value: 'prev_month', label: 'Previous month' },
  { value: 'custom', label: 'Custom' },
];

const ROLLUPS: Rollup[] = ['day', 'week', 'month'];

export interface DateRangeValue {
  start: string;
  end: string;
  rollup: Rollup;
  compareMode: CompareMode;
  matchWeekdays: boolean;
  compareStart?: string;
  compareEnd?: string;
}

export function DateRangeMenu({
  value,
  onChange,
}: {
  value: DateRangeValue;
  onChange: (patch: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const label = `${value.start} → ${value.end}`;
  const activePreset = PRESETS.find((p) => {
    const r = p.range();
    return r.start === value.start && r.end === value.end;
  });

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-fg hover:bg-surface-2"
      >
        <span aria-hidden>🗓</span>
        <span>{activePreset?.label ?? label}</span>
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[34rem] max-w-[90vw] rounded-xl border border-line bg-surface p-4 shadow-lg">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Left: comparison + settings + granularity */}
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Comparison
              </div>
              <div className="flex flex-col">
                {COMPARE.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => onChange({ compareMode: c.value === 'previous' ? '' : c.value })}
                    className={
                      'rounded-md px-2 py-1 text-left text-sm ' +
                      ((value.compareMode ?? 'previous') === c.value
                        ? 'bg-surface-2 font-medium text-fg'
                        : 'text-muted hover:text-fg')
                    }
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {value.compareMode === 'custom' && (
                <div className="mt-2 flex flex-col gap-1">
                  <input
                    type="date"
                    value={value.compareStart ?? ''}
                    onChange={(e) => onChange({ compareStart: e.target.value })}
                    className="rounded-md border border-line bg-bg px-2 py-1 text-sm"
                  />
                  <input
                    type="date"
                    value={value.compareEnd ?? ''}
                    onChange={(e) => onChange({ compareEnd: e.target.value })}
                    className="rounded-md border border-line bg-bg px-2 py-1 text-sm"
                  />
                </div>
              )}
              <label className="mt-3 flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={value.matchWeekdays}
                  onChange={(e) => onChange({ matchWeekdays: e.target.checked ? '1' : '' })}
                />
                Match weekdays (YoY)
              </label>
              <div className="mt-3 mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Granularity
              </div>
              <div className="inline-flex rounded-lg border border-line p-0.5">
                {ROLLUPS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => onChange({ rollup: r })}
                    className={
                      'rounded-md px-2.5 py-1 text-sm capitalize ' +
                      (value.rollup === r ? 'bg-surface-2 text-fg' : 'text-muted hover:text-fg')
                    }
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {/* Right: presets + custom */}
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Date range
              </div>
              <div className="flex flex-col">
                {PRESETS.map((p) => {
                  const r = p.range();
                  const active = r.start === value.start && r.end === value.end;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => onChange({ start: r.start, end: r.end, range: '' })}
                      className={
                        'rounded-md px-2 py-1 text-left text-sm ' +
                        (active ? 'bg-surface-2 font-medium text-fg' : 'text-muted hover:text-fg')
                      }
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex flex-col gap-1">
                <span className="text-xs text-muted">Custom</span>
                <input
                  type="date"
                  value={value.start}
                  onChange={(e) => onChange({ start: e.target.value, range: '' })}
                  className="rounded-md border border-line bg-bg px-2 py-1 text-sm"
                />
                <input
                  type="date"
                  value={value.end}
                  onChange={(e) => onChange({ end: e.target.value, range: '' })}
                  className="rounded-md border border-line bg-bg px-2 py-1 text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
