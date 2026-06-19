import { useEffect, useState } from 'react';
import { api } from './api';
import { Badge, Card, PageHeader, Spinner, StatCard, Table, Td, Th } from './components/ui';
import { Bars } from './components/charts';

type Quota = Awaited<ReturnType<typeof api.getQuota>>;

function fmt(n: number): string {
  return n.toLocaleString();
}

export default function Quota() {
  const [q, setQ] = useState<Quota | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getQuota()
      .then(setQ)
      .catch((e) => setErr(String(e)));
  }, []);

  if (err) return <p className="text-sm text-muted">Could not load quota: {err}</p>;
  if (!q) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const pct = q.capacity.projectQpdUsedPct;
  const verdict =
    pct < 1
      ? {
          tone: 'ok' as const,
          text: 'Plenty of headroom — API quota is nowhere near a constraint.',
        }
      : pct < 25
        ? { tone: 'ok' as const, text: 'Comfortable headroom.' }
        : pct < 75
          ? { tone: 'warn' as const, text: 'Moderate usage — keep an eye on it.' }
          : {
              tone: 'bad' as const,
              text: 'Approaching the project daily quota — spread collection.',
            };

  return (
    <div>
      <PageHeader
        title="API quota & capacity"
        description="How much of Google's Search Console API quota you're using, and how many more properties you could add. Measured from actual API calls."
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Capacity (more sites)"
          value={q.capacity.estMoreProperties === null ? '—' : fmt(q.capacity.estMoreProperties)}
          hint="before the per-project daily quota"
          tone="accent"
        />
        <StatCard
          label="Calls today"
          value={fmt(q.today.total)}
          hint={`${q.capacity.projectQpdUsedPct}% of project/day`}
        />
        <StatCard
          label="Active properties"
          value={q.capacity.activeProperties}
          hint={`~${q.capacity.avgCallsPerProperty} calls/property`}
        />
        <StatCard
          label="Per-user headroom"
          value={`${q.perUserHeadroomPct}%`}
          hint={`dispatch ${fmt(q.dispatchQpmPerAccount)} QPM`}
          tone="ok"
        />
      </div>

      <Card className="mb-5">
        <div className="flex items-center gap-2">
          <Badge tone={verdict.tone}>
            {verdict.tone === 'ok' ? 'Healthy' : verdict.tone === 'warn' ? 'Watch' : 'High'}
          </Badge>
          <p className="text-sm">{verdict.text}</p>
        </div>
        <p className="mt-2 text-sm text-muted">
          The practical limit is daily-run time per account, not quota. To go faster, spread
          properties across more Google accounts (each is an independent{' '}
          {fmt(q.dispatchQpmPerAccount)} QPM lane).
        </p>
      </Card>

      {q.today.byAccount.length > 0 && (
        <Card title="Calls by account (today vs 7-day)" className="mb-5">
          <Bars
            data={q.today.byAccount.map((a) => ({
              name: a.displayName.length > 14 ? a.displayName.slice(0, 13) + '…' : a.displayName,
              today: a.callsToday,
              week: a.calls7d,
            }))}
            xKey="name"
            bars={[
              { key: 'today', name: 'Today', color: 'var(--accent)' },
              { key: 'week', name: '7-day', color: 'var(--fresh)' },
            ]}
          />
        </Card>
      )}

      <Card title="Usage by account (today / 7-day)" className="mb-5" bodyClassName="p-0">
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Account</Th>
              <Th className="text-right">Properties</Th>
              <Th className="text-right">Calls today</Th>
              <Th className="text-right">Tasks today</Th>
              <Th className="text-right">Calls (7d)</Th>
            </tr>
          </thead>
          <tbody>
            {q.today.byAccount.length === 0 && (
              <tr>
                <Td className="px-3 py-6 text-muted">
                  No API usage recorded yet — run a collection to populate this.
                </Td>
              </tr>
            )}
            {q.today.byAccount.map((a) => (
              <tr key={a.accountId ?? 'unattributed'}>
                <Td className="font-medium">{a.displayName}</Td>
                <Td className="text-right">{fmt(a.properties)}</Td>
                <Td className="text-right">{fmt(a.callsToday)}</Td>
                <Td className="text-right">{fmt(a.tasksToday)}</Td>
                <Td className="text-right">{fmt(a.calls7d)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card title="Google limits (Search Analytics)">
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted">Per user</dt>
            <dd className="font-semibold">{fmt(q.limits.perUserQpm)} QPM</dd>
          </div>
          <div>
            <dt className="text-muted">Per site</dt>
            <dd className="font-semibold">{fmt(q.limits.perSiteQpm)} QPM</dd>
          </div>
          <div>
            <dt className="text-muted">Per project</dt>
            <dd className="font-semibold">
              {fmt(q.limits.perProjectQpm)} QPM · {fmt(q.limits.perProjectQpd)} QPD
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">
          Source:{' '}
          <a
            className="text-accent hover:underline"
            href={q.limits.source}
            target="_blank"
            rel="noreferrer"
          >
            developers.google.com/webmaster-tools/limits
          </a>
        </p>
      </Card>
    </div>
  );
}
