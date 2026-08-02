/**
 * ClientConfigureView — the "Configure" tab for a Client (IA v2): rename, client-level brand terms
 * (used by the brand/non-brand segment across all its properties), and the member-property list
 * (each links to its own collection/config). Per-property collection settings live on the property.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from './api';
import { useToast } from './components/feedback';
import { Badge, Button, Card, Field, Spinner, TextInput } from './components/ui';

type Member = { id: string; siteUrl: string; propertyType: string; source: string };

export default function ClientConfigureView() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [members, setMembers] = useState<Member[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .clientDetail(id)
      .then((d) => {
        setName(d.name);
        setBrand((d.brandTerms ?? []).join(', '));
        setMembers(d.properties);
      })
      .catch(() => setMembers([]));
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

  if (!members) {
    return (
      <div className="grid place-items-center py-16 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card
        title="Client"
        actions={
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
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
          The sites this client owns. Collection settings live on each property; reassign a property
          to another client from{' '}
          <Link to="/properties" className="text-accent">
            Properties
          </Link>
          .
        </p>
        <ul className="flex flex-col divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-2">
              <span className="break-all text-sm">{m.siteUrl}</span>
              <span className="flex items-center gap-2">
                {m.source === 'native_export' && <Badge tone="ok">export</Badge>}
                <Link
                  to={`/clients/property/${m.id}/configure`}
                  className="whitespace-nowrap text-sm text-accent hover:underline"
                >
                  Configure →
                </Link>
              </span>
            </li>
          ))}
          {members.length === 0 && <li className="py-2 text-sm text-muted">No properties.</li>}
        </ul>
      </Card>
    </div>
  );
}
