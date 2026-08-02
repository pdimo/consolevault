/**
 * Clients — the top-level index of the businesses you report for (IA v2). Each client owns one or
 * more properties; its card opens the client workspace (aggregate report + opportunities + config).
 * Manage the underlying properties and how they're grouped under Admin → Properties.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DashboardListItem } from '@consolevault/types';
import { api } from './api';
import { Badge, Button, Card, EmptyState, PageHeader, SearchInput, Spinner } from './components/ui';

export default function Clients() {
  const [list, setList] = useState<DashboardListItem[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    api
      .listClients()
      .then(setList)
      .catch(() => setList([]));
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
        description="The businesses you report for. Each client owns one or more properties — open one to see its report, opportunities and configuration."
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
          description="Connect a Google account or a BigQuery export, then track a property — each becomes a client here."
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
          {filtered.map((c) => {
            const n = c.propertyCount ?? 1;
            const chip =
              c.kind === 'export'
                ? { label: 'BigQuery export', tone: 'ok' as const }
                : c.kind === 'rollup'
                  ? { label: `Rollup · ${n}`, tone: 'accent' as const }
                  : { label: 'Property', tone: 'neutral' as const };
            return (
              <Link key={`${c.type}:${c.id}`} to={`/clients/${c.type}/${c.id}/report`}>
                <Card className="h-full transition-colors hover:border-accent">
                  <div className="flex items-start justify-between gap-2">
                    <p className="break-all font-medium">{c.name}</p>
                    <Badge tone={chip.tone}>{chip.label}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-accent">Open report →</p>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
