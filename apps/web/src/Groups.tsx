import { useEffect, useState } from 'react';
import type { Property, PropertyGroup } from '@consolevault/types';
import { api } from './api';

export default function Groups() {
  const [groups, setGroups] = useState<PropertyGroup[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setGroups(await api.listGroups());
    setProperties(await api.listProperties());
  };
  useEffect(() => {
    load().catch((e: unknown) => setError(String(e)));
  }, []);

  const toggle = (id: string) =>
    setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const create = async () => {
    setError(null);
    try {
      await api.createGroup(name, members);
      setName('');
      setMembers([]);
      await load();
    } catch (e) {
      setError(String(e));
    }
  };

  const nameOf = (id: string) => properties.find((p) => p.id === id)?.siteUrl ?? id;

  return (
    <section>
      <h2>Property groups</h2>
      <p className="muted">
        App-level groups union members at query time (a generated view in <code>gsc_views</code>).
      </p>
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Members</th>
            <th>View</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.id}>
              <td>
                {g.name}
                {g.doubleCountWarning && (
                  <span className="badge" style={{ background: 'var(--amber)', marginLeft: 8 }}>
                    double-count risk
                  </span>
                )}
              </td>
              <td>{g.memberPropertyIds.map(nameOf).join(', ')}</td>
              <td>
                <code>{g.viewId ?? '—'}</code>
              </td>
              <td>
                <button onClick={() => void api.deleteGroup(g.id).then(load)}>Delete</button>
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No groups yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>New group</h3>
        <div className="row">
          <input placeholder="group name" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="primary"
            disabled={!name || members.length === 0}
            onClick={() => void create()}
          >
            Create
          </button>
        </div>
        <div style={{ marginTop: 10, maxHeight: 220, overflow: 'auto' }}>
          {properties.map((p) => (
            <label key={p.id} style={{ display: 'block', fontSize: 14 }}>
              <input
                type="checkbox"
                checked={members.includes(p.id)}
                onChange={() => toggle(p.id)}
              />{' '}
              <code>{p.siteUrl}</code>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
