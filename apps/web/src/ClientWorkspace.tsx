/**
 * ClientWorkspace — the client-first shell. Everything about one client (a tracked property or a
 * rollup) lives here under tabs: Report, Opportunities, and (for a property) Configure. The client
 * switcher lets you hop between clients without leaving the workspace. Tab contents are the existing
 * pages (Dashboard / Opportunities / Property), re-parented under `/clients/:type/:id/*`.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import type { DashboardListItem, Property } from '@consolevault/types';
import { api } from './api';
import { propertyStatus } from './propertyStatus';
import { Badge, Select, Spinner, cx } from './components/ui';

export default function ClientWorkspace() {
  const { type = '', id = '' } = useParams();
  const navigate = useNavigate();
  const [clients, setClients] = useState<DashboardListItem[] | null>(null);
  const [property, setProperty] = useState<Property | null>(null);

  useEffect(() => {
    api
      .listClients()
      .then(setClients)
      .catch(() => setClients([]));
  }, []);

  useEffect(() => {
    if (type !== 'property') {
      setProperty(null);
      return;
    }
    api
      .listProperties()
      .then((all) => setProperty(all.find((p) => p.id === id) ?? null))
      .catch(() => setProperty(null));
  }, [type, id]);

  const current = useMemo(
    () => (clients ?? []).find((c) => c.type === type && c.id === id) ?? null,
    [clients, type, id],
  );
  const status = property ? propertyStatus(property) : null;

  // Properties and rollups get the same feature set — a rollup is a first-class client.
  const tabs = [
    { to: 'report', label: 'Report' },
    { to: 'opportunities', label: 'Opportunities' },
    { to: 'content', label: 'Content & topics' },
    { to: 'coverage', label: 'Coverage' },
    { to: 'configure', label: 'Configure' },
  ];

  if (!clients) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div>
      {/* Client identity: switcher + type + collection status */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={`${type}:${id}`}
          onChange={(e) => {
            const [t, i] = e.target.value.split(':');
            navigate(`/clients/${t}/${i}/report`);
          }}
          className="max-w-xs font-medium"
        >
          {current == null && <option value={`${type}:${id}`}>{id}</option>}
          {clients.map((c) => (
            <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
              {c.name}
            </option>
          ))}
        </Select>
        <Badge tone={type === 'group' ? 'accent' : 'neutral'}>
          {type === 'group' ? 'rollup' : 'property'}
        </Badge>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
        {type === 'group' && (
          <Link to="/groups" className="ml-auto text-sm text-accent hover:underline">
            Manage in Rollups →
          </Link>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cx(
                'relative -mb-px rounded-t-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'border-x border-t border-line bg-surface text-fg'
                  : 'text-muted hover:text-fg',
              )
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet />
    </div>
  );
}
