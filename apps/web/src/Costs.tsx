import { useEffect, useState } from 'react';
import { api } from './api';
import { Card, PageHeader, Spinner, StatCard, Table, Td, Th } from './components/ui';
import { Donut } from './components/charts';

type Costs = Awaited<ReturnType<typeof api.getCosts>>;

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

export default function Costs() {
  const [costs, setCosts] = useState<Costs | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCosts()
      .then(setCosts)
      .catch((e) => setErr(String(e)));
  }, []);

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

      {costs.spend ? (
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
      ) : (
        <p className="mt-4 text-sm text-muted">
          Tip: enable Cloud Billing export to see <em>actual</em> spend here — see{' '}
          <a
            className="text-accent hover:underline"
            href="https://github.com/pdimo/consolevault/blob/main/docs/BILLING-EXPORT.md"
          >
            docs/BILLING-EXPORT.md
          </a>
          .
        </p>
      )}
    </div>
  );
}
