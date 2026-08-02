/**
 * ClientConfigureView — the "Configure" tab for a Client (IA v2): rename, client-level brand terms,
 * and MANAGE which properties the client owns. Add a property to turn a single property into a
 * rollup; remove one (it becomes its own client); delete the client (its properties split back out).
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Property } from '@consolevault/types';
import { api } from './api';
import { useConfirm, useToast } from './components/feedback';
import { Badge, Button, Card, Field, Select, Spinner, TextInput } from './components/ui';

type Member = { id: string; siteUrl: string; propertyType: string; source: string };

export default function ClientConfigureView() {
  const { id = '' } = useParams();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [members, setMembers] = useState<Member[] | null>(null);
  const [allProps, setAllProps] = useState<Property[]>([]);
  const [addId, setAddId] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [detail, props] = await Promise.all([api.clientDetail(id), api.listProperties()]);
    setName(detail.name);
    setBrand((detail.brandTerms ?? []).join(', '));
    setMembers(detail.properties);
    setAllProps(props);
  };
  useEffect(() => {
    load().catch(() => setMembers([]));
  }, [id]);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateClient(id, {
        name: name.trim(),
        brandTerms: brand
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      toast('Saved', 'success');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      toast(ok, 'success');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const addProperty = () => {
    if (!addId) return;
    void run(async () => {
      await api.patchProperty(addId, { clientId: id });
      setAddId('');
    }, 'Property added');
  };

  const removeMember = (m: Member) =>
    void run(() => api.detachProperty(m.id), `${m.siteUrl} moved to its own client`);

  const remove = async () => {
    if (
      await confirm({
        title: `Delete this client?`,
        message:
          'Its properties are split back into their own single-property clients (no data is deleted).',
        confirmLabel: 'Delete',
        danger: true,
      })
    ) {
      try {
        await api.deleteClient(id);
        toast('Client deleted', 'success');
        navigate('/clients');
      } catch (e) {
        toast(String(e), 'error');
      }
    }
  };

  if (!members) {
    return (
      <div className="grid place-items-center py-16 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const memberIds = new Set(members.map((m) => m.id));
  const available = allProps.filter((p) => p.included && !memberIds.has(p.id));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card
        title="Client"
        actions={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => void remove()}>
              Delete
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Client name">
            <TextInput value={name} onChange={(e) => setName(e.target.value)} className="w-full" />
          </Field>
          <Field label="Brand terms">
            <TextInput
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. acme, acme login"
              className="w-full"
            />
          </Field>
          <p className="text-xs text-muted">
            Comma-separated. A query is <strong>brand</strong> if it contains any term
            (case-insensitive) — drives the report&apos;s brand/non-brand segment across all this
            client&apos;s properties. Applied at query time, so edits take effect immediately.
          </p>
        </div>
      </Card>

      <Card title={`Properties (${members.length})`}>
        <p className="mb-3 text-sm text-muted">
          The sites this client owns. Add a property to make this a <strong>rollup</strong>; remove
          one and it becomes its own client. Collection settings live on each property.
        </p>

        <div className="mb-3 flex items-end gap-2">
          <Field label="Add a property">
            <Select
              value={addId}
              onChange={(e) => setAddId(e.target.value)}
              className="w-full max-w-xs"
            >
              <option value="">Select a property…</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.siteUrl}
                </option>
              ))}
            </Select>
          </Field>
          <Button disabled={busy || !addId} onClick={addProperty}>
            Add
          </Button>
        </div>

        <ul className="flex flex-col divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span className="break-all text-sm">{m.siteUrl}</span>
              <span className="flex items-center gap-2">
                {m.source === 'native_export' && <Badge tone="ok">export</Badge>}
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeMember(m)}>
                  Remove
                </Button>
              </span>
            </li>
          ))}
          {members.length === 0 && <li className="py-2 text-sm text-muted">No properties.</li>}
        </ul>
      </Card>
    </div>
  );
}
