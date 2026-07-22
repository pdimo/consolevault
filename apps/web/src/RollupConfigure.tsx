/**
 * RollupConfigure — the "Configure" tab of a rollup client: how the rollup reports (brand terms,
 * daily precompute, materialized table) plus its member list. Membership itself is still built and
 * torn down on the Rollups page; here you tune reporting for an existing rollup.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Property, PropertyGroup } from '@consolevault/types';
import { api } from './api';
import { useToast } from './components/feedback';
import { Badge, Button, Card, Spinner, Switch, TextInput } from './components/ui';

export default function RollupConfigure() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [group, setGroup] = useState<PropertyGroup | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [brandTerms, setBrandTerms] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [groups, props] = await Promise.all([api.listGroups(), api.listProperties()]);
    const g = groups.find((x) => x.id === id) ?? null;
    setGroup(g);
    setProperties(props);
    setBrandTerms((g?.brandTerms ?? []).join(', '));
  };
  useEffect(() => {
    void load();
  }, [id]);

  const members = useMemo(
    () => properties.filter((p) => (group?.memberPropertyIds ?? []).includes(p.id)),
    [properties, group],
  );

  if (!group) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const patch = async (p: Partial<PropertyGroup>, msg: string) => {
    try {
      await api.patchGroup(id, p);
      toast(msg, 'success');
      await load();
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  const saveBrand = async () => {
    setSaving(true);
    await patch(
      {
        brandTerms: brandTerms
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      },
      'Saved',
    );
    setSaving(false);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card
        title="Rollup settings"
        actions={
          <Button variant="primary" loading={saving} onClick={() => void saveBrand()}>
            Save
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">Precompute daily</span>
              <span className="block text-xs text-muted">
                Warm this rollup&apos;s report cache each morning.
              </span>
            </span>
            <Switch
              checked={group.dashboardEnabled ?? false}
              onChange={() => void patch({ dashboardEnabled: !group.dashboardEnabled }, 'Updated')}
              label="Precompute daily"
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              <span className="font-medium">Materialized table</span>
              <span className="block text-xs text-muted">
                Keep a refreshed BigQuery table for faster BI tools.
              </span>
            </span>
            <Switch
              checked={group.materialized ?? false}
              onChange={() => void patch({ materialized: !group.materialized }, 'Updated')}
              label="Materialized table"
            />
          </label>
          <div>
            <p className="mb-1 text-sm font-semibold">Brand terms</p>
            <p className="mb-2 text-xs text-muted">
              Comma-separated. Drives the brand/non-brand split across the rollup — applied at query
              time, so edits take effect immediately.
            </p>
            <TextInput
              className="w-full"
              placeholder="e.g. acme, acme login"
              value={brandTerms}
              onChange={(e) => setBrandTerms(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card
        title={`Members (${members.length})`}
        actions={
          <Link to="/groups" className="text-sm text-accent hover:underline">
            Edit membership →
          </Link>
        }
      >
        {group.doubleCountWarning && (
          <div className="mb-3">
            <Badge tone="warn">
              Double-count risk: a domain and its URL-prefix child are both members
            </Badge>
          </div>
        )}
        {members.length === 0 ? (
          <p className="text-sm text-muted">No members.</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {members.map((p) => (
              <li key={p.id} className="break-all border-b border-line py-1.5 last:border-0">
                {p.siteUrl}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
