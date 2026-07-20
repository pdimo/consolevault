import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Property, PropertyGroup } from '@consolevault/types';
import { api } from './api';
import { useConfirm, useToast } from './components/feedback';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Switch,
  TextInput,
  Table,
  Td,
  Th,
} from './components/ui';

/** Inline brand-terms editor for a group row (comma-separated; saves on demand). */
function BrandCell({ group, onSaved }: { group: PropertyGroup; onSaved: () => void }) {
  const toast = useToast();
  const initial = (group.brandTerms ?? []).join(', ');
  const [val, setVal] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = val.trim() !== initial;
  const save = async () => {
    setSaving(true);
    try {
      await api.patchGroup(group.id, {
        brandTerms: val
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast('Brand terms saved', 'success');
      onSaved();
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex items-center gap-1">
      <TextInput
        className="w-40"
        placeholder="brand, brand login"
        value={val}
        onChange={(e) => setVal(e.target.value)}
      />
      {dirty && (
        <Button size="sm" loading={saving} onClick={() => void save()}>
          Save
        </Button>
      )}
    </div>
  );
}

export default function Groups() {
  const toast = useToast();
  const confirm = useConfirm();
  const [groups, setGroups] = useState<PropertyGroup[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const load = async () => {
    setGroups(await api.listGroups());
    setProperties(await api.listProperties());
  };
  useEffect(() => {
    load().catch((e: unknown) => toast(String(e), 'error'));
  }, []);

  const toggle = (id: string) =>
    setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const create = async () => {
    try {
      await api.createGroup(name, members);
      setName('');
      setMembers([]);
      await load();
      toast('Group created', 'success');
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  const remove = async (g: PropertyGroup) => {
    if (await confirm({ title: `Delete "${g.name}"?`, confirmLabel: 'Delete', danger: true })) {
      await api.deleteGroup(g.id);
      await load();
      toast('Group deleted', 'success');
    }
  };

  const nameOf = (id: string) => properties.find((p) => p.id === id)?.siteUrl ?? id;
  // Only TRACKED properties are groupable — the union view aggregates collected data, which only
  // exists for properties being tracked. (e.g. group a domain + its sub-domains into one collection.)
  const trackable = properties.filter((p) => p.included);
  const shownProps = trackable.filter((p) =>
    p.siteUrl.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div>
      <PageHeader
        title="Property groups"
        description="Groups union their members at query time (a view in gsc_views). Toggle Materialized to also keep a refreshed table for faster BI."
      />

      {groups.length === 0 ? (
        <EmptyState
          icon="❏"
          title="No groups yet"
          description="Create a group below to combine properties into one queryable view."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Members</Th>
              <Th>View</Th>
              <Th>Materialized</Th>
              <Th>Dashboard</Th>
              <Th>Brand terms</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="hover:bg-surface-2/50">
                <Td className="font-medium">
                  {g.name}
                  {g.doubleCountWarning && (
                    <Badge tone="warn" className="ml-2">
                      double-count risk
                    </Badge>
                  )}
                </Td>
                <Td className="text-muted">{g.memberPropertyIds.map(nameOf).join(', ')}</Td>
                <Td>
                  <code className="text-xs">{g.viewId ?? '—'}</code>
                </Td>
                <Td>
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={g.materialized ?? false}
                      onChange={() =>
                        void api
                          .patchGroup(g.id, { materialized: !g.materialized })
                          .then(load)
                          .then(() =>
                            toast(g.materialized ? 'Unmaterialized' : 'Materialized', 'success'),
                          )
                      }
                    />
                    {g.materialized ? <code className="text-xs">{g.viewId}_mat</code> : 'off'}
                  </label>
                </Td>
                <Td>
                  <Switch
                    checked={g.dashboardEnabled ?? false}
                    onChange={() =>
                      void api
                        .patchGroup(g.id, { dashboardEnabled: !g.dashboardEnabled })
                        .then(load)
                        .then(() =>
                          toast(
                            g.dashboardEnabled ? 'Dashboard disabled' : 'Dashboard enabled',
                            'success',
                          ),
                        )
                    }
                    label="Dashboard"
                  />
                </Td>
                <Td>
                  <BrandCell group={g} onSaved={load} />
                </Td>
                <Td>
                  <Button size="sm" variant="ghost" onClick={() => void remove(g)}>
                    Delete
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Card title="New group" className="mt-5">
        <p className="mb-3 text-sm text-muted">
          Combine <strong>tracked</strong> properties (e.g. a domain and its sub-domains) into one
          collection. Only tracked properties can be grouped — the union aggregates collected data.
        </p>
        {trackable.length === 0 ? (
          <EmptyState
            title="No tracked properties yet"
            description="Track some properties first — then group them here."
            action={
              <Link to="/properties">
                <Button variant="primary">Go to Properties</Button>
              </Link>
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <TextInput
                placeholder="Group name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <Button
                variant="primary"
                disabled={!name || members.length === 0}
                onClick={() => void create()}
              >
                Create ({members.length})
              </Button>
            </div>
            <TextInput
              className="mt-3 w-full sm:w-80"
              placeholder="Search tracked properties…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="mt-3 max-h-72 overflow-auto rounded-lg border border-line">
              {shownProps.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-0 hover:bg-surface-2/50"
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-accent"
                    checked={members.includes(p.id)}
                    onChange={() => toggle(p.id)}
                  />
                  <code className="text-xs">{p.siteUrl}</code>
                  <span className="text-xs text-muted">
                    {p.propertyType === 'domain' ? 'domain' : 'url-prefix'}
                  </span>
                </label>
              ))}
              {shownProps.length === 0 && (
                <p className="px-3 py-4 text-sm text-muted">No tracked properties match.</p>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
