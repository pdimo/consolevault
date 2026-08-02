/**
 * ClientWorkspace — the client-first shell (IA v2). A client owns one or more properties; its tabs
 * (Report, Opportunities, Content & topics, Coverage, Configure) show the AGGREGATE across its
 * properties. A second switcher drills into a single property (its own report). The client switcher
 * hops between clients. Tab contents are the existing pages re-parented under `/clients/:type/:id/*`.
 */

import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import type { DashboardListItem, Property } from '@consolevault/types';
import { api } from './api';
import { propertyStatus } from './propertyStatus';
import { Badge, Select, Spinner, cx } from './components/ui';

type Member = { id: string; siteUrl: string; propertyType: string; source: string };

export default function ClientWorkspace() {
  const { type = '', id = '' } = useParams();
  const navigate = useNavigate();
  const [clients, setClients] = useState<DashboardListItem[] | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [clientId, setClientId] = useState<string>('');

  useEffect(() => {
    api
      .listClients()
      .then(setClients)
      .catch(() => setClients([]));
  }, []);

  // Load the single property when drilling into one (for the status badge + its owning client).
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

  // Resolve the current client id (the client itself, or the owning client of the drilled property)
  // and load its member properties for the sub-switcher.
  useEffect(() => {
    const cid = type === 'client' ? id : (property?.clientId ?? '');
    setClientId(cid);
    if (!cid) {
      setMembers([]);
      return;
    }
    api
      .clientDetail(cid)
      .then((d) => setMembers(d.properties))
      .catch(() => setMembers([]));
  }, [type, id, property]);

  const current = useMemo(
    () => (clients ?? []).find((c) => c.type === type && c.id === id) ?? null,
    [clients, type, id],
  );
  const status = property ? propertyStatus(property) : null;

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

  // The sub-switcher's current value: 'all' (aggregate client) or a member property id.
  const subValue = type === 'property' ? id : 'all';
  const showSub = Boolean(clientId) && members.length > 1;

  return (
    <div>
      {/* Client identity: client switcher + (optional) property sub-switcher + status */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select
          value={clientId ? `client:${clientId}` : `${type}:${id}`}
          onChange={(e) => {
            const [t, i] = e.target.value.split(':');
            navigate(`/clients/${t}/${i}/report`);
          }}
          className="max-w-xs font-medium"
        >
          {current == null && !clientId && <option value={`${type}:${id}`}>{id}</option>}
          {clients.map((c) => (
            <option key={`${c.type}:${c.id}`} value={`${c.type}:${c.id}`}>
              {c.name}
            </option>
          ))}
        </Select>

        {showSub && (
          <Select
            value={subValue}
            onChange={(e) => {
              const v = e.target.value;
              navigate(
                v === 'all'
                  ? `/clients/client/${clientId}/report`
                  : `/clients/property/${v}/report`,
              );
            }}
            className="max-w-xs"
          >
            <option value="all">All properties ({members.length})</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.siteUrl}
              </option>
            ))}
          </Select>
        )}

        {type === 'client' && members.length > 1 && (
          <Badge tone="accent">{members.length} properties</Badge>
        )}
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
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
