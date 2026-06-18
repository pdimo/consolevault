import { useEffect, useState } from 'react';
import type { Account, TokenHealth } from '@consolevault/types';
import { api } from './api';
import { useAuth } from './auth';

const HEALTH_COLOR: Record<TokenHealth, string> = {
  valid: 'var(--green)',
  expires_soon: 'var(--amber)',
  broken: 'var(--red)',
  revoked: 'var(--red)',
};

export default function Accounts() {
  const { state } = useAuth();
  const sa = state.collectorServiceAccount ?? '';
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [saEmail, setSaEmail] = useState('');
  const [saLabel, setSaLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .listAccounts()
      .then(setAccounts)
      .catch((e: unknown) => setError(String(e)));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (sa && !saEmail) setSaEmail(sa);
  }, [sa, saEmail]);

  const connectBanner = new URLSearchParams(window.location.search).get('connect');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    const { url } = await api.connectStart();
    window.location.href = url;
  };

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Accounts</h2>
        <button className="primary" onClick={() => void connect()}>
          + Connect Google account
        </button>
      </div>
      {connectBanner === 'success' && (
        <p style={{ color: 'var(--green)' }}>Account connected — properties discovered below.</p>
      )}
      {connectBanner === 'denied' && <p className="error">Connection was cancelled.</p>}
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Email</th>
            <th>Token health</th>
            <th>Last success</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((a) => (
            <tr key={a.id}>
              <td>{a.displayName}</td>
              <td>{a.type === 'oauth' ? 'OAuth' : 'Service account'}</td>
              <td>{a.email ?? '—'}</td>
              <td>
                <span className="badge" style={{ background: HEALTH_COLOR[a.tokenHealth] }}>
                  {a.tokenHealth}
                </span>
              </td>
              <td>{a.lastSuccessAt ? new Date(a.lastSuccessAt).toLocaleString() : '—'}</td>
              <td className="row">
                <button disabled={busy} onClick={() => void run(() => api.discover(a.id))}>
                  Discover
                </button>
                <button disabled={busy} onClick={() => void run(() => api.checkHealth(a.id))}>
                  Check health
                </button>
                <button disabled={busy} onClick={() => void run(() => api.deleteAccount(a.id))}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No accounts yet — connect a Google account or register the service account below.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Service-account access</h3>
        <p className="muted">
          For clients who can&apos;t share an OAuth login: add <strong>this</strong> service-account
          email as a user (Restricted is enough) on their Search Console property, then register it.
        </p>
        <div className="row">
          <code style={{ fontSize: 14 }}>{sa || '…'}</code>
          <button disabled={!sa} onClick={() => void navigator.clipboard.writeText(sa)}>
            Copy
          </button>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">
            service account email (defaults to the one above)
            <input
              value={saEmail}
              onChange={(e) => setSaEmail(e.target.value)}
              style={{ width: 380 }}
            />
          </label>
          <label className="field">
            label
            <input value={saLabel} onChange={(e) => setSaLabel(e.target.value)} />
          </label>
          <button
            disabled={busy || !saEmail}
            onClick={() => void run(() => api.addServiceAccount(saEmail, saLabel))}
          >
            Register
          </button>
        </div>
      </div>
    </section>
  );
}
