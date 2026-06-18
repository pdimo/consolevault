import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Account, Property } from '@consolevault/types';
import { api } from './api';

export default function Properties() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setProperties(await api.listProperties());
    setAccounts(await api.listAccounts());
  };
  useEffect(() => {
    load().catch((e: unknown) => setError(String(e)));
  }, []);

  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.displayName ?? id.slice(0, 8);

  const toggle = async (p: Property) => {
    setError(null);
    try {
      await api.patchProperty(p.id, { included: !p.included });
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const shown = properties.filter((p) => p.siteUrl.toLowerCase().includes(filter.toLowerCase()));

  return (
    <section>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>Properties ({properties.length})</h2>
        <input placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Collect</th>
            <th>Property</th>
            <th>Type</th>
            <th>Permission</th>
            <th>Account(s)</th>
            <th>Types</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => (
            <tr key={p.id}>
              <td>
                <input type="checkbox" checked={p.included} onChange={() => void toggle(p)} />
              </td>
              <td>
                <Link to={`/properties/${p.id}`}>
                  <code>{p.siteUrl}</code>
                </Link>
              </td>
              <td>
                <span className="tag">{p.propertyType === 'domain' ? 'Domain' : 'URL-prefix'}</span>
              </td>
              <td>{p.permissionLevel ?? '—'}</td>
              <td>
                {p.accountIds.map(accountName).join(', ')}
                {p.preferredAccountId && p.accountIds.length > 1 && (
                  <span className="muted"> (pref: {accountName(p.preferredAccountId)})</span>
                )}
              </td>
              <td>{p.config.types.join(', ')}</td>
              <td>
                <Link to={`/properties/${p.id}`}>Configure →</Link>
              </td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No properties — connect an account (discovery runs automatically).
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
