import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api';
import type { Property } from '@consolevault/types';
import { propertyStatus } from './propertyStatus';
import { Button, Card, EmptyState, PageHeader, Spinner, StatCard } from './components/ui';
import { Donut, TrendArea } from './components/charts';

type Overview = Awaited<ReturnType<typeof api.getOverview>>;

const MIX = [
  { kind: 'final', name: 'Final', color: 'var(--ok)' },
  { kind: 'fresh', name: 'Fresh', color: 'var(--fresh)' },
  { kind: 'collecting', name: 'Collecting', color: 'var(--warn)' },
  { kind: 'error', name: 'Error', color: 'var(--bad)' },
] as const;

export default function Overview() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getOverview()
      .then(setOv)
      .catch((e) => setErr(String(e)));
    api
      .listProperties()
      .then(setProperties)
      .catch(() => undefined);
  }, []);

  const coverageMix = useMemo(() => {
    const tracked = (properties ?? []).filter((p) => p.included);
    return MIX.map((m) => ({
      name: m.name,
      color: m.color,
      value: tracked.filter((p) => propertyStatus(p).kind === m.kind).length,
    })).filter((d) => d.value > 0);
  }, [properties]);

  if (err) return <p className="text-sm text-muted">Could not load overview: {err}</p>;
  if (!ov) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const needsOnboarding =
    ov.accounts.total === 0 || (ov.properties.total === 0 && ov.accounts.total > 0);

  if (needsOnboarding) {
    return (
      <div>
        <PageHeader title="Overview" />
        <EmptyState
          icon="◎"
          title={
            ov.accounts.total === 0 ? 'Connect your first account' : 'Discover your properties'
          }
          description={
            ov.accounts.total === 0
              ? 'Connect a Google account to start pulling Search Console data into your warehouse.'
              : 'Run discovery to list the properties available to track.'
          }
          action={
            <Link to="/accounts">
              <Button variant="primary">Go to Accounts</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Overview" description="A snapshot of your connections and collection." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Accounts"
          value={ov.accounts.total}
          hint={`${ov.accounts.healthy} healthy`}
          tone={ov.accounts.healthy === ov.accounts.total ? 'ok' : 'warn'}
        />
        <StatCard
          label="Tracking"
          value={ov.properties.tracking}
          hint={`${ov.properties.available} available`}
          tone="accent"
        />
        <StatCard
          label="Rows collected"
          value={ov.rows.toLocaleString()}
          hint="across all datasets"
        />
        <StatCard
          label="Open errors"
          value={ov.openErrors}
          hint={ov.openErrors ? 'in Jobs → dead-letter' : 'none'}
          tone={ov.openErrors ? 'bad' : 'ok'}
        />
        <StatCard label="API calls today" value={ov.apiCallsToday.toLocaleString()} />
        <StatCard label="Latest final day" value={ov.latestFinalDate ?? '—'} />
        <StatCard label="Est. monthly storage" value={`≈ $${ov.estMonthlyStorageUsd.toFixed(2)}`} />
        <StatCard label="Total properties" value={ov.properties.total} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Collection activity (14 days)" className="lg:col-span-2">
          {ov.activity.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No activity yet.</p>
          ) : (
            <TrendArea
              data={ov.activity}
              xKey="date"
              series={[{ key: 'rows', name: 'Rows', color: 'var(--accent)' }]}
            />
          )}
        </Card>
        <Card title="Tracked properties by status">
          {coverageMix.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">No tracked properties yet.</p>
          ) : (
            <Donut data={coverageMix} />
          )}
        </Card>
      </div>

      <Card className="mt-5" title="Next steps">
        <ul className="space-y-2 text-sm">
          <li className="flex items-center justify-between gap-3">
            <span>Choose which properties to track</span>
            <Link to="/properties" className="text-accent hover:underline">
              Properties →
            </Link>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Check collection health &amp; recent jobs</span>
            <Link to="/jobs" className="text-accent hover:underline">
              Jobs →
            </Link>
          </li>
          <li className="flex items-center justify-between gap-3">
            <span>Review API capacity &amp; storage costs</span>
            <span className="flex gap-3">
              <Link to="/quota" className="text-accent hover:underline">
                Quota →
              </Link>
              <Link to="/costs" className="text-accent hover:underline">
                Costs →
              </Link>
            </span>
          </li>
        </ul>
      </Card>
    </div>
  );
}
