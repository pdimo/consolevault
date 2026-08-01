import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Account, Property } from '@consolevault/types';
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
  const [tab, setTab] = useState<Tab>('tracking');
  const [filter, setFilter] = useState('');
  const [acct, setAcct] = useState('any');
  const [statusFilter, setStatusFilter] = useState<StatusKind | 'any'>('any');
  const [sort, setSort] = useState<Sort>('url');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    setProperties(await api.listProperties());
    setAccounts(await api.listAccounts());
  };
  useEffect(() => {
    load().catch((e: unknown) => toast(String(e), 'error'));
  }, []);

  const accountName = (id: string) =>
    accounts.find((a) => a.id === id)?.displayName ?? id.slice(0, 8);

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
    } catch (e) {
      toast(String(e), 'error');
      await load();
    }
  };

  const bulk = async (included: boolean) => {
    const ids = [...selected];
    if (ids.length === 0) return;
    try {
      await api.bulkSetIncluded(ids, included);
      setSelected(new Set());
      await load();
      toast(
        `${included ? 'Now tracking' : 'Stopped tracking'} ${ids.length} propert${ids.length === 1 ? 'y' : 'ies'}`,
        'success',
      );
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
          description="Connect a Google account and run Discover to list the properties available to track."
          action={
            <Link to="/accounts">
              <Button variant="primary">Go to Accounts</Button>
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
