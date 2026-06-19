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
  Tooltip,
  XAxis,
  YAxis,
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
  series: { key: string; name: string; color: string }[];
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
            fill={`url(#g-${s.key})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Donut for categorical breakdowns (coverage mix, storage by dataset). */
export function Donut({
  data,
  height = 220,
}: {
  data: { name: string; value: number; color?: string }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="80%"
          paddingAngle={2}
        >
          {data.map((d, i) => (
            <Cell key={d.name} fill={d.color ?? CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP} />
        <Legend
          verticalAlign="middle"
          align="right"
          layout="vertical"
          iconType="circle"
          wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }}
        />
      </PieChart>
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
