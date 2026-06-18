import { useEffect, useState } from 'react';
import type { Property } from '@consolevault/types';
import { api } from './api';

function TypeTag({ kind }: { kind: Property['propertyType'] }) {
  const isDomain = kind === 'domain';
  return (
    <span
      style={{
        background: isDomain ? '#1a73e8' : '#5f6368',
        color: 'white',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 12,
      }}
    >
      {isDomain ? 'Domain' : 'URL-prefix'}
    </span>
  );
}

export default function Properties({ reloadKey }: { reloadKey: number }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api
      .listProperties()
      .then(setProperties)
      .catch((e: unknown) => setError(String(e)));
  };
  useEffect(refresh, [reloadKey]);

  const toggle = async (p: Property) => {
    setError(null);
    try {
      await api.setIncluded(p.id, !p.included);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <section>
      <h2>Properties ({properties.length})</h2>
      {error && <p style={{ color: '#c5221f' }}>{error}</p>}
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ccc' }}>
            <th>Included</th>
            <th>Property</th>
            <th>Type</th>
            <th>Permission</th>
            <th>Accounts</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
              <td>
                <input type="checkbox" checked={p.included} onChange={() => toggle(p)} />
              </td>
              <td>
                <code>{p.siteUrl}</code>
              </td>
              <td>
                <TypeTag kind={p.propertyType} />
              </td>
              <td>{p.permissionLevel ?? '—'}</td>
              <td>{p.accountIds.length}</td>
            </tr>
          ))}
          {properties.length === 0 && (
            <tr>
              <td colSpan={5}>No properties yet — run discovery on an account.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
