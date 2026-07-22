/**
 * Clients — the index of everything you collect for: tracked properties and rollups. Each card opens
 * that client's workspace (report + opportunities + configuration). Replaces the old "Dashboards"
 * directory; a client no longer needs a separate "enable dashboard" toggle to appear here.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardListItem, PropertyGroup } from '@consolevault/types';
import { api } from './api';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Spinner } from './components/ui';

export default function Clients() {
  const [list, setList] = useState<DashboardListItem[] | null>(null);
  const [groups, setGroups] = useState<PropertyGroup[]>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    api
      .listClients()
      .then(setList)
      .catch(() => setList([]));
    api
      .listGroups()
      .then(setGroups)
      .catch(() => setGroups([]));
  }, []);

  const filtered = useMemo(
    () => (list ?? []).filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase())),
    [list, q],
  );

  if (!list) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Every property and rollup you're collecting. Open one to see its report, opportunities and configuration."
        actions={
          list.length > 0 ? (
            <SearchInput
              placeholder="Search clients…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-56"
            />
          ) : undefined
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon="◧"
          title="No clients yet"
          description="Track a property (Properties) or create a rollup (Rollups) to start collecting and reporting."
          action={
            <Link to="/properties">
              <Button variant="primary">Go to Properties</Button>
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState icon="⌕" title="No matches" description={`No client matches “${q}”.`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Link key={`${c.type}:${c.id}`} to={`/clients/${c.type}/${c.id}/report`}>
              <Card className="h-full transition-colors hover:border-accent">
                <div className="flex items-start justify-between gap-2">
                  <p className="break-all font-medium">{c.name}</p>
                  <Badge tone={c.type === 'group' ? 'accent' : 'neutral'}>
                    {c.type === 'group' ? 'rollup' : 'property'}
                  </Badge>
                </div>
                {c.type === 'group' && (
                  <p className="mt-1 text-xs text-muted">
                    {groups.find((g) => g.id === c.id)?.memberPropertyIds.length ?? 0} properties
                    combined
                  </p>
                )}
                <p className="mt-3 text-sm text-accent">Open report →</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
