import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Scatter as RScatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';

/** Theme-aware palette (resolves to light/dark via CSS vars). */
export const CHART_COLORS = [
  'var(--accent)',
  'var(--ok)',
  'var(--fresh)',
  'var(--warn)',
  'var(--bad)',
  '#a78bfa',
  '#f472b6',
];

const TOOLTIP = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--fg)',
  fontSize: 12,
} as const;
const axisProps = { stroke: 'var(--muted)', fontSize: 11, tickLine: false } as const;

function compact(n: number): string {
  return Intl.NumberFormat('en', { notation: 'compact' }).format(n);
}

/** Stacked/overlaid area trend (e.g. collection activity over time). */
export function TrendArea({
  data,
  xKey,
  series,
  height = 220,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  /** `dashed` renders a fill-free dashed line — used for the comparison-period overlay. */
  series: { key: string; name: string; color: string; dashed?: boolean }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.5} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis {...axisProps} width={42} tickFormatter={compact} />
        <Tooltip contentStyle={TOOLTIP} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            fill={s.dashed ? 'none' : `url(#g-${s.key})`}
            strokeWidth={2}
            strokeDasharray={s.dashed ? '4 3' : undefined}
            dot={false}
            connectNulls
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/**
 * Donut for categorical breakdowns. Keeps the chart legible by showing only the top `topN` slices
 * and rolling the long tail into a single "Other" slice (UI-only — the source data is untouched).
 * Uses a custom, responsive, truncating legend with percentages (Recharts' built-in legend overflows
 * with many categories, especially on mobile).
 */
export function Donut({
  data,
  height = 220,
  topN = 6,
}: {
  data: { name: string; value: number; color?: string }[];
  height?: number;
  topN?: number;
}) {
  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, topN);
  const restValue = sorted.slice(topN).reduce((s, d) => s + d.value, 0);
  const slices =
    restValue > 0 ? [...head, { name: 'Other', value: restValue, color: 'var(--muted)' }] : head;
  const total = slices.reduce((s, d) => s + d.value, 0) || 1;
  const colorOf = (d: { color?: string }, i: number) =>
    d.color ?? CHART_COLORS[i % CHART_COLORS.length];

  return (
    <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
      <div className="w-full sm:w-1/2">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="82%"
              paddingAngle={2}
            >
              {slices.map((d, i) => (
                <Cell key={d.name} fill={colorOf(d, i)} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP} formatter={(v: number) => compact(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-1 text-sm sm:w-1/2">
        {slices.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: colorOf(d, i) }}
            />
            <span className="min-w-0 flex-1 truncate" title={d.name}>
              {d.name || '(unknown)'}
            </span>
            <span className="shrink-0 tabular-nums text-muted">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Stacked area (e.g. impressions by ranking tier over time). */
export function StackedArea({
  data,
  xKey,
  series,
  height = 260,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  series: { key: string; name: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <XAxis dataKey={xKey} {...axisProps} tickFormatter={(v: string) => v.slice(5)} />
        <YAxis {...axisProps} width={42} tickFormatter={compact} />
        <Tooltip contentStyle={TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            stackId="1"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.55}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Bubble scatter (e.g. CTR vs position; bubble size = impressions). */
export function Bubble({
  data,
  xLabel,
  yLabel,
  height = 300,
  xReversed = false,
  yPercent = false,
}: {
  data: { x: number; y: number; z: number; name: string }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  xReversed?: boolean;
  yPercent?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
        <XAxis type="number" dataKey="x" name={xLabel} reversed={xReversed} {...axisProps} />
        <YAxis
          type="number"
          dataKey="y"
          name={yLabel}
          {...axisProps}
          width={46}
          tickFormatter={(v: number) => (yPercent ? `${v}%` : compact(v))}
        />
        <ZAxis type="number" dataKey="z" range={[20, 420]} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ strokeDasharray: '3 3' }} />
        <RScatter data={data} fill="var(--accent)" fillOpacity={0.45} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/** Grouped bars (e.g. usage by account: today vs 7-day). */
export function Bars({
  data,
  xKey,
  bars,
  height = 240,
}: {
  data: Record<string, unknown>[];
  xKey: string;
  bars: { key: string; name: string; color: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
        <XAxis dataKey={xKey} {...axisProps} />
        <YAxis {...axisProps} width={42} tickFormatter={compact} />
        <Tooltip contentStyle={TOOLTIP} cursor={{ fill: 'var(--surface-2)' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
        {bars.map((b) => (
          <Bar key={b.key} dataKey={b.key} name={b.name} fill={b.color} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
