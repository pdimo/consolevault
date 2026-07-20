import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { useToast } from './components/feedback';
import { Badge, Button, Card, PageHeader, Spinner, StatCard, Table, Td, Th } from './components/ui';
import { Donut } from './components/charts';

type Costs = Awaited<ReturnType<typeof api.getCosts>>;
type BillingStatus = Awaited<ReturnType<typeof api.getBillingStatus>>;

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let v = b / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

/** Guided opt-in for real Cloud Billing spend: toggle on → one Console step → auto-detected status. */
function BillingSetup({
  status,
  busy,
  onSetEnabled,
  onRecheck,
}: {
  status: BillingStatus;
  busy: boolean;
  onSetEnabled: (enabled: boolean) => void;
  onRecheck: () => void;
}) {
  const exportUrl = status.billingAccountId
    ? `https://console.cloud.google.com/billing/${status.billingAccountId}/export/bigquery?project=${status.projectId}`
    : `https://console.cloud.google.com/billing?project=${status.projectId}`;

  if (!status.enabled) {
    return (
      <Card title="Real spend" className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted">
            The figures above are <em>estimates</em>. Switch on real Cloud Billing spend to see
            exact charges per service — it takes one quick step in the Google Cloud Console.
          </p>
          <Button variant="primary" loading={busy} onClick={() => onSetEnabled(true)}>
            Set up real spend
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Real spend setup"
      className="mt-5"
      actions={
        <Button loading={busy} onClick={() => onSetEnabled(false)}>
          Use estimates instead
        </Button>
      }
    >
      {!status.exportConfigured ? (
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            One-time step in Google Cloud (we can&apos;t do this for you — Cloud Billing export is
            Console-only):
          </p>
          <ol className="ml-4 list-decimal space-y-1">
            <li>
              Open{' '}
              <a
                className="text-accent hover:underline"
                href={exportUrl}
                target="_blank"
                rel="noreferrer"
              >
                Billing → Billing export → BigQuery export
              </a>
              .
            </li>
            <li>
              Under <strong>Standard usage cost</strong>, click <strong>Edit settings</strong>.
            </li>
            <li>
              Set <strong>Project</strong> = <code>{status.projectId}</code> and{' '}
              <strong>Dataset</strong> = <code>{status.dataset}</code>, then <strong>Save</strong>.
            </li>
          </ol>
          <p className="text-xs text-muted">
            Google then writes the export table; first data usually lands within a few hours (up to
            ~24h) and isn&apos;t backfilled.
          </p>
          <Button loading={busy} onClick={onRecheck}>
            I&apos;ve configured it — check now
          </Button>
        </div>
      ) : !status.dataFlowing ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">
            <Badge tone="ok">configured ✓</Badge> Waiting for Google&apos;s first daily export —
            usually within a few hours, up to ~24h. The panel switches to real spend automatically.
          </p>
          <Button loading={busy} onClick={onRecheck}>
            Check again
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">
          <Badge tone="ok">live ✓</Badge> Showing real Cloud Billing spend
          {status.lastDataDate ? ` (data through ${status.lastDataDate})` : ''}.
        </p>
      )}
    </Card>
  );
}

export default function Costs() {
  const toast = useToast();
  const [costs, setCosts] = useState<Costs | null>(null);
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => {
    api
      .getCosts()
      .then(setCosts)
      .catch((e) => setErr(String(e)));
    api
      .getBillingStatus()
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  useEffect(() => reload(), [reload]);

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    try {
      const settings = await api.getSettings();
      await api.putSettings({ ...settings, billingExportEnabled: enabled });
      toast(enabled ? 'Real spend enabled' : 'Using estimates', 'success');
      reload();
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const recheck = async () => {
    setBusy(true);
    try {
      const s = await api.getBillingStatus();
      setStatus(s);
      reload();
      toast(
        s.dataFlowing
          ? 'Real spend is live'
          : s.exportConfigured
            ? 'Configured — waiting for first data'
            : 'Export not detected yet',
        s.exportConfigured ? 'success' : 'info',
      );
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (err) return <p className="text-sm text-muted">Could not load costs: {err}</p>;
  if (!costs) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Costs"
        description="BigQuery storage is the main ongoing charge; collection is near-free. Your Cloud Billing budget alerts at 50/90/100% — no surprise bills."
      />

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Total storage" value={fmtBytes(costs.totalBytes)} />
        <StatCard
          label="Est. monthly storage"
          value={`≈ $${costs.estMonthlyStorageUsd.toFixed(2)}`}
          hint="~$0.02/GiB·mo"
          tone="accent"
        />
        {costs.spend && (
          <StatCard
            label="Actual spend (30d)"
            value={`${costs.spend.total.toFixed(2)} ${costs.spend.currency}`}
            tone="ok"
          />
        )}
      </div>

      {costs.totalBytes > 0 && (
        <Card title="Storage share by dataset" className="mb-5">
          <Donut
            data={costs.datasets
              .filter((d) => d.bytes > 0)
              .map((d) => ({ name: d.dataset, value: d.bytes }))}
          />
        </Card>
      )}

      <Card title="Storage by dataset" bodyClassName="p-0">
        <Table className="rounded-none border-0">
          <thead>
            <tr>
              <Th>Dataset</Th>
              <Th className="text-right">Tables</Th>
              <Th className="text-right">Rows</Th>
              <Th className="text-right">Storage</Th>
            </tr>
          </thead>
          <tbody>
            {costs.datasets.map((d) => (
              <tr key={d.dataset}>
                <Td className="font-medium">{d.dataset}</Td>
                <Td className="text-right">{d.tables.toLocaleString()}</Td>
                <Td className="text-right">{d.rows.toLocaleString()}</Td>
                <Td className="text-right">{fmtBytes(d.bytes)}</Td>
              </tr>
            ))}
            <tr className="font-semibold">
              <Td>Total</Td>
              <Td className="text-right">
                {costs.datasets.reduce((s, d) => s + d.tables, 0).toLocaleString()}
              </Td>
              <Td className="text-right">
                {costs.datasets.reduce((s, d) => s + d.rows, 0).toLocaleString()}
              </Td>
              <Td className="text-right">{fmtBytes(costs.totalBytes)}</Td>
            </tr>
          </tbody>
        </Table>
      </Card>

      {status && (
        <BillingSetup
          status={status}
          busy={busy}
          onSetEnabled={(v) => void setEnabled(v)}
          onRecheck={() => void recheck()}
        />
      )}

      {costs.spend && (
        <Card
          title="Actual spend — last 30 days (billing export)"
          className="mt-5"
          bodyClassName="p-0"
        >
          <Table className="rounded-none border-0">
            <thead>
              <tr>
                <Th>Service</Th>
                <Th className="text-right">Cost ({costs.spend.currency})</Th>
              </tr>
            </thead>
            <tbody>
              {costs.spend.byService.map((s) => (
                <tr key={s.service}>
                  <Td>{s.service}</Td>
                  <Td className="text-right">{s.cost.toFixed(2)}</Td>
                </tr>
              ))}
              <tr className="font-semibold">
                <Td>Total</Td>
                <Td className="text-right">
                  {costs.spend.total.toFixed(2)} {costs.spend.currency}
                </Td>
              </tr>
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
