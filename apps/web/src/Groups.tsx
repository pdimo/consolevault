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
  TextInput,
  Table,
  Td,
  Th,
} from './components/ui';

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
        title="Rollups"
        description="A rollup unions several properties into one queryable view (in gsc_views) so you can report on them together — distinct from a property's content groups & topic clusters. Open a rollup for its report, brand terms and settings."
      />

      {groups.length === 0 ? (
        <EmptyState
          icon="❏"
          title="No rollups yet"
          description="Create a rollup below to combine properties into one queryable view."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Members</Th>
              <Th>Rollup view</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.id} className="hover:bg-surface-2/50">
                <Td className="font-medium">
                  <Link
                    to={`/clients/group/${g.id}/report`}
                    className="text-accent hover:underline"
                  >
                    {g.name}
                  </Link>
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
                  <div className="flex items-center justify-end gap-3">
                    <Link
                      to={`/clients/group/${g.id}/report`}
                      className="whitespace-nowrap text-sm text-accent hover:underline"
                    >
                      Open →
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => void remove(g)}>
                      Delete
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <Card title="New rollup" className="mt-5">
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
