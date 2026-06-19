import { useEffect, useState } from 'react';
import { api } from './api';

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

  if (err) return <p className="muted">Could not load quota: {err}</p>;
  if (!q) return <p className="muted">Loading…</p>;

  // Plain-language verdict: GSC quota is volume-huge; the practical limit is per-account run time.
  const pct = q.capacity.projectQpdUsedPct;
  const verdict =
    pct < 1
      ? 'Plenty of headroom — API quota is nowhere near a constraint.'
      : pct < 25
        ? 'Comfortable headroom.'
        : pct < 75
          ? 'Moderate usage — keep an eye on it.'
          : 'Approaching the project daily quota — consider spreading collection.';

  return (
    <section>
      <h2>API quota &amp; capacity</h2>
      <p className="muted">
        How much of Google&apos;s Search Console API quota you&apos;re using, and how many more
        properties you could add. Usage is measured from actual API calls and accrues from when this
        feature shipped.
      </p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Capacity</h3>
        <p style={{ fontSize: 18 }}>
          You can add roughly{' '}
          <strong>
            {q.capacity.estMoreProperties === null
              ? '—'
              : `${fmt(q.capacity.estMoreProperties)} more properties`}
          </strong>{' '}
          before approaching Google&apos;s per-project daily quota.
        </p>
        <p className="muted">
          {verdict} Today you&apos;ve used <strong>{fmt(q.today.total)}</strong> API calls —{' '}
          {q.capacity.projectQpdUsedPct}% of the {fmt(q.limits.perProjectQpd)}/day project limit —
          across {q.capacity.activeProperties} included properties (~
          {q.capacity.avgCallsPerProperty} calls/property/day). Per account we dispatch at{' '}
          {fmt(q.dispatchQpmPerAccount)} QPM, leaving {q.perUserHeadroomPct}% headroom under the{' '}
          {fmt(q.limits.perUserQpm)} QPM per-user cap. The practical limit is daily-run time per
          account, not quota.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Usage by account (today / 7-day)</h3>
        <table className="grid">
          <thead>
            <tr>
              <th>Account</th>
              <th style={{ textAlign: 'right' }}>Properties</th>
              <th style={{ textAlign: 'right' }}>Calls today</th>
              <th style={{ textAlign: 'right' }}>Tasks today</th>
              <th style={{ textAlign: 'right' }}>Calls (7d)</th>
            </tr>
          </thead>
          <tbody>
            {q.today.byAccount.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No API usage recorded yet — run a collection to populate this.
                </td>
              </tr>
            )}
            {q.today.byAccount.map((a) => (
              <tr key={a.accountId ?? 'unattributed'}>
                <td>{a.displayName}</td>
                <td style={{ textAlign: 'right' }}>{fmt(a.properties)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(a.callsToday)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(a.tasksToday)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(a.calls7d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Google limits (Search Analytics)</h3>
        <table className="grid">
          <tbody>
            <tr>
              <td>Per user</td>
              <td style={{ textAlign: 'right' }}>{fmt(q.limits.perUserQpm)} QPM</td>
            </tr>
            <tr>
              <td>Per site</td>
              <td style={{ textAlign: 'right' }}>{fmt(q.limits.perSiteQpm)} QPM</td>
            </tr>
            <tr>
              <td>Per project</td>
              <td style={{ textAlign: 'right' }}>
                {fmt(q.limits.perProjectQpm)} QPM · {fmt(q.limits.perProjectQpd)} QPD
              </td>
            </tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 8 }}>
          Source:{' '}
          <a href={q.limits.source} target="_blank" rel="noreferrer">
            developers.google.com/webmaster-tools/limits
          </a>
        </p>
      </div>
    </section>
  );
}
