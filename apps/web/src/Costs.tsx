import { useEffect, useState } from 'react';
import { api } from './api';

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

  if (err) return <p className="muted">Could not load costs: {err}</p>;
  if (!costs) return <p className="muted">Loading…</p>;

  return (
    <section>
      <h2>Costs</h2>
      <p className="muted">
        BigQuery storage by dataset. Storage cost is the main ongoing charge; collection (API +
        Cloud Run + load jobs) is near-free at this volume. Your Cloud Billing budget alerts at
        50/90/100% — you will never get a surprise bill.
      </p>

      <div className="card">
        <table className="grid">
          <thead>
            <tr>
              <th>Dataset</th>
              <th style={{ textAlign: 'right' }}>Tables</th>
              <th style={{ textAlign: 'right' }}>Rows</th>
              <th style={{ textAlign: 'right' }}>Storage</th>
            </tr>
          </thead>
          <tbody>
            {costs.datasets.map((d) => (
              <tr key={d.dataset}>
                <td>{d.dataset}</td>
                <td style={{ textAlign: 'right' }}>{d.tables.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{d.rows.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{fmtBytes(d.bytes)}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 600, borderTop: '2px solid #ccc' }}>
              <td>Total</td>
              <td style={{ textAlign: 'right' }}>
                {costs.datasets.reduce((s, d) => s + d.tables, 0).toLocaleString()}
              </td>
              <td style={{ textAlign: 'right' }}>
                {costs.datasets.reduce((s, d) => s + d.rows, 0).toLocaleString()}
              </td>
              <td style={{ textAlign: 'right' }}>{fmtBytes(costs.totalBytes)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 12 }}>
        Estimated monthly storage: <strong>≈ ${costs.estMonthlyStorageUsd.toFixed(2)}</strong>{' '}
        (active logical storage at ~$0.02/GiB·mo, US multi-region — an estimate, not a bill).
        Retention is controlled by the <code>default_partition_expiry_days</code> Terraform
        variable.
      </p>
    </section>
  );
}
