import { useEffect, useState } from 'react';
import type { Account, TokenHealth } from '@consolevault/types';
import { api } from './api';

const HEALTH_COLOR: Record<TokenHealth, string> = {
  valid: '#137333',
  expires_soon: '#b06000',
  broken: '#c5221f',
  revoked: '#c5221f',
};

function Badge({ health }: { health: TokenHealth }) {
  return (
    <span
      style={{
        background: HEALTH_COLOR[health],
        color: 'white',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 12,
      }}
    >
      {health}
    </span>
  );
}

export default function Accounts({ onChanged }: { onChanged: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api
      .listAccounts()
      .then(setAccounts)
      .catch((e: unknown) => setError(String(e)));
  };
  useEffect(refresh, []);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      refresh();
      onChanged();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <h2>Accounts</h2>
      {error && <p style={{ color: '#c5221f' }}>{error}</p>}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
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
            <tr key={a.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>{a.displayName}</td>
              <td>{a.type}</td>
              <td>{a.email ?? '—'}</td>
              <td>
                <Badge health={a.tokenHealth} />
              </td>
              <td>{a.lastSuccessAt ? new Date(a.lastSuccessAt).toLocaleString() : '—'}</td>
              <td>
                <button
                  disabled={busy !== null}
                  onClick={() => run('d' + a.id, () => api.discover(a.id))}
                >
                  Run discovery
                </button>{' '}
                <button
                  disabled={busy !== null}
                  onClick={() => run('h' + a.id, () => api.checkHealth(a.id))}
                >
                  Check health
                </button>{' '}
                <button
                  disabled={busy !== null}
                  onClick={() => run('x' + a.id, () => api.deleteAccount(a.id))}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr>
              <td colSpan={6}>No accounts yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      <h3>Add a service account</h3>
      <p>
        Add the service-account email as a user on the client&apos;s Search Console property first
        (see docs/AUTH.md, Scenario C).
      </p>
      <input
        placeholder="sa-collector@project.iam.gserviceaccount.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: 380 }}
      />{' '}
      <input
        placeholder="label (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />{' '}
      <button
        disabled={busy !== null || !email}
        onClick={() =>
          run('add', () => api.addServiceAccount(email, name)).then(() => setEmail(''))
        }
      >
        Add
      </button>
      <h3>Add an OAuth account</h3>
      <p>
        OAuth accounts are added with the local helper (a browser consent flow):
        <br />
        <code>
          node tools/oauth-helper add-oauth --client-json &lt;path&gt; --name &quot;label&quot;
        </code>
        <br />
        See <code>docs/AUTH.md</code> in the repository for the full per-scenario setup.
      </p>
    </section>
  );
}
