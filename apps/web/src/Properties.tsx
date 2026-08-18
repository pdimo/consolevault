import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Account, DashboardListItem, Property } from '@consolevault/types';
import { api } from './api';
import { useToast } from './components/feedback';
import { propertyStatus, type StatusKind } from './propertyStatus';
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  SearchInput,
  SegmentedControl,
  Select,
  Spinner,
  Switch,
  Table,
  Td,
  Th,
} from './components/ui';

type Tab = 'tracking' | 'available' | 'all';
type Sort = 'url' | 'recent' | 'status';

const STATUS_LABEL: Record<StatusKind | 'any', string> = {
  any: 'Any status',
  fresh: 'Fresh',
  final: 'Final',
  collecting: 'Collecting',
  error: 'Error',
  untracked: 'Not tracked',
  imported: 'BigQuery export',
};

export default function Properties() {
  const toast = useToast();
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [clients, setClients] = useState<DashboardListItem[]>([]);
  const [tab, setTab] = useState<Tab>('tracking');
  const [filter, setFilter] = useState('');
  const [acct, setAcct] = useState('any');
  const [statusFilter, setStatusFilter] = useState<StatusKind | 'any'>('any');
  const [sort, setSort] = useState<Sort>('url');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    setProperties(await api.listProperties());
    setAccounts(await api.listAccounts());
    setClients((await api.listClients()).filter((c) => c.type === 'client'));
  };
  useEffect(() => {
    load().catch((e: unknown) => toast(String(e), 'error'));
  }, []);

  // --- Start collecting as soon as something is tracked ------------------------------------
  // Tracking a property used to do nothing visible until the next daily run. Now it fires a
  // scoped pipeline run. Batched briefly so tracking twelve properties is one run, not twelve —
  // and flushed on unmount, because navigating away mid-wait would otherwise silently drop it.
  const pendingCollect = useRef<Set<string>>(new Set());
  const collectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushCollection = () => {
    if (collectTimer.current) {
      clearTimeout(collectTimer.current);
      collectTimer.current = null;
    }
    const ids = [...pendingCollect.current];
    pendingCollect.current = new Set();
    if (ids.length === 0) return;
    // Fire-and-forget: over-firing is harmless (reconcile skips in-flight cells and Cloud Tasks
    // dedups on task name), whereas blocking the UI on a workflow execution is not.
    api
      .runPipeline(ids)
      .then(() =>
        toast(
          `Collecting — ${ids.length} propert${ids.length === 1 ? 'y' : 'ies'} queued`,
          'success',
        ),
      )
      .catch((e: unknown) => toast(String(e), 'error'));
  };

  const queueCollection = (props: Property[]) => {
    // Native-export properties are read from their Bulk Export dataset; there is nothing to collect.
    const ids = props.filter((p) => p.source !== 'native_export').map((p) => p.id);
    if (ids.length === 0) return;
    for (const id of ids) pendingCollect.current.add(id);
    if (collectTimer.current) clearTimeout(collectTimer.current);
    collectTimer.current = setTimeout(flushCollection, 4000);
  };

  useEffect(() => flushCollection, []);

  // While anything is tracked-but-not-yet-collected, refresh so the status chip moves on its own.
  // Bounded: collection of a first property takes minutes, and we don't want a tab polling forever
  // if a property never collects (no data, a broken token).
  const awaitingFirstRows = (properties ?? []).some(
    (p) => p.included && p.source !== 'native_export' && !p.status?.lastCollectedDate,
  );
  useEffect(() => {
    if (!awaitingFirstRows) return;
    let polls = 0;
    const id = setInterval(() => {
      if (++polls > 40) return clearInterval(id); // ~10 min at 15s
      void load().catch(() => {});
    }, 15_000);
    return () => clearInterval(id);
  }, [awaitingFirstRows]);

  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.displayName ?? id.slice(0, 8);
  const clientName = (id?: string) => clients.find((c) => c.id === id)?.name;

  // Bulk-assign the selected properties to one client — an existing one or a new rollup.
  const bulkAssign = async (value: string) => {
    const ids = [...selected];
    if (ids.length === 0 || !value) return;
    try {
      if (value === '__new') {
        const name = window.prompt('New client name?')?.trim();
        if (!name) return;
        await api.createClient(name, ids);
      } else {
        await Promise.all(ids.map((pid) => api.patchProperty(pid, { clientId: value })));
      }
      setSelected(new Set());
      await load();
      toast(
        `Assigned ${ids.length} propert${ids.length === 1 ? 'y' : 'ies'} to a client`,
        'success',
      );
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  // Reassign a property to another client (or create a new client for it).
  const assign = async (p: Property, value: string) => {
    try {
      let clientId = value;
      if (value === '__new') {
        const name = window.prompt('New client name?', clientName(p.clientId) ?? '')?.trim();
        if (!name) return;
        clientId = (await api.createClient(name, [p.id])).id;
      } else {
        await api.patchProperty(p.id, { clientId });
      }
      await load();
      toast('Property reassigned', 'success');
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  const counts = useMemo(() => {
    const tracking = properties?.filter((p) => p.included).length ?? 0;
    return {
      tracking,
      available: (properties?.length ?? 0) - tracking,
      all: properties?.length ?? 0,
    };
  }, [properties]);

  const shown = useMemo(() => {
    if (!properties) return [];
    const f = filter.toLowerCase();
    const list = properties
      .filter((p) => (tab === 'tracking' ? p.included : tab === 'available' ? !p.included : true))
      .filter((p) => p.siteUrl.toLowerCase().includes(f))
      .filter((p) => acct === 'any' || p.accountIds.includes(acct))
      .filter((p) => statusFilter === 'any' || propertyStatus(p).kind === statusFilter);
    list.sort((a, b) => {
      if (sort === 'url') return a.siteUrl.localeCompare(b.siteUrl);
      if (sort === 'recent')
        return (b.status?.lastCollectedDate ?? '').localeCompare(a.status?.lastCollectedDate ?? '');
      return propertyStatus(a).kind.localeCompare(propertyStatus(b).kind);
    });
    return list;
  }, [properties, tab, filter, acct, statusFilter, sort]);

  const toggle = async (p: Property) => {
    setProperties(
      (ps) => ps?.map((x) => (x.id === p.id ? { ...x, included: !x.included } : x)) ?? ps,
    );
    try {
      await api.patchProperty(p.id, { included: !p.included });
      if (!p.included) queueCollection([p]);
    } catch (e) {
      toast(String(e), 'error');
      await load();
    }
  };

  const bulk = async (included: boolean) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    const newlyTracked = included
      ? (properties ?? []).filter((p) => ids.includes(p.id) && !p.included)
      : [];
    try {
      await api.bulkSetIncluded(ids, included);
      setSelected(new Set());
      await load();
      toast(
        `${included ? 'Now tracking' : 'Stopped tracking'} ${ids.length} propert${ids.length === 1 ? 'y' : 'ies'}`,
        'success',
      );
      queueCollection(newlyTracked);
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  const allShownSelected = shown.length > 0 && shown.every((p) => selected.has(p.id));
  const toggleSelectAll = () =>
    setSelected((sel) => {
      const next = new Set(sel);
      if (allShownSelected) shown.forEach((p) => next.delete(p.id));
      else shown.forEach((p) => next.add(p.id));
      return next;
    });

  if (!properties) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (properties.length === 0) {
    return (
      <div>
        <PageHeader title="Properties" />
        <EmptyState
          icon="▦"
          title="No properties yet"
          description="Connect a data source, then run Discover to list the properties available to track."
          action={
            <Link to="/accounts">
              <Button variant="primary">Go to Connections</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Properties"
        description={`Tracking ${counts.tracking} · Available ${counts.available} · ${accounts.length} account${accounts.length === 1 ? '' : 's'}`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl<Tab>
          value={tab}
          onChange={(v) => {
            setTab(v);
            setSelected(new Set());
          }}
          options={[
            { value: 'tracking', label: `Tracking (${counts.tracking})` },
            { value: 'available', label: `Available (${counts.available})` },
            { value: 'all', label: `All (${counts.all})` },
          ]}
        />
        <span className="flex-1" />
        <SearchInput
          className="w-full sm:w-64"
          placeholder="Search by URL…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <Select value={acct} onChange={(e) => setAcct(e.target.value)}>
          <option value="any">Any account</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.displayName}
            </option>
          ))}
        </Select>
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusKind | 'any')}
        >
          {(Object.keys(STATUS_LABEL) as (StatusKind | 'any')[]).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="url">Sort: URL</option>
          <option value="recent">Sort: Most recent</option>
          <option value="status">Sort: Status</option>
        </Select>
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="primary" onClick={() => void bulk(true)}>
            Track
          </Button>
          <Button size="sm" onClick={() => void bulk(false)}>
            Stop tracking
          </Button>
          <Select
            value=""
            onChange={(e) => void bulkAssign(e.target.value)}
            className="text-sm"
            aria-label="Assign selected to client"
          >
            <option value="">Assign to client…</option>
            <option value="__new">＋ New client (rollup)</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <button className="text-muted hover:text-fg" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <Table>
        <thead>
          <tr>
            <Th className="w-10 pl-4">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={allShownSelected}
                onChange={toggleSelectAll}
                aria-label="Select all"
              />
            </Th>
            <Th>Property</Th>
            <Th>Client</Th>
            <Th className="w-44">Status</Th>
            <Th>Account(s)</Th>
            <Th>Search types</Th>
            <Th className="w-24 text-center">Track</Th>
            <Th className="w-28 pr-4 text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((p) => {
            const st = propertyStatus(p);
            return (
              <tr key={p.id} className="hover:bg-surface-2/50">
                <Td className="pl-4">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={selected.has(p.id)}
                    onChange={() =>
                      setSelected((sel) => {
                        const next = new Set(sel);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                    aria-label="Select"
                  />
                </Td>
                <Td>
                  <Link
                    to={`/properties/${p.id}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {p.siteUrl}
                  </Link>
                  <div className="text-xs text-muted">
                    {p.propertyType === 'domain' ? 'Domain' : 'URL-prefix'}
                    {p.source === 'native_export' && ' · BigQuery export'}
                  </div>
                </Td>
                <Td>
                  {p.included ? (
                    <Select
                      value={p.clientId ?? ''}
                      onChange={(e) => void assign(p, e.target.value)}
                      className="max-w-48 text-sm"
                    >
                      {!p.clientId && <option value="">— unassigned —</option>}
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                      <option value="__new">＋ New client…</option>
                    </Select>
                  ) : (
                    <span className="text-xs text-muted">—</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-muted">
                  {p.accountIds.map(accountName).join(', ')}
                </Td>
                <Td className="text-muted">
                  {p.source === 'native_export' ? '—' : p.config.types.join(', ')}
                </Td>
                <Td className="text-center">
                  <div className="flex justify-center">
                    <Switch
                      checked={p.included}
                      onChange={() => void toggle(p)}
                      label={p.included ? 'Stop tracking' : 'Track'}
                    />
                  </div>
                </Td>
                <Td className="pr-4 text-right">
                  <Link
                    to={`/properties/${p.id}`}
                    className="whitespace-nowrap text-sm text-accent hover:underline"
                  >
                    Configure →
                  </Link>
                </Td>
              </tr>
            );
          })}
          {shown.length === 0 && (
            <tr>
              <Td className="px-4 py-6 text-muted">No properties match these filters.</Td>
            </tr>
          )}
        </tbody>
      </Table>
    </div>
  );
}
