import { useEffect, useState } from 'react';
import type { Account, TokenHealth } from '@consolevault/types';
import { api } from './api';
import { useAuth } from './auth';
import { useConfirm, useToast } from './components/feedback';
import {
  Badge,
  Button,
  Card,
  Field,
  PageHeader,
  Spinner,
  Table,
  Td,
  TextInput,
  Th,
} from './components/ui';

type Tone = NonNullable<Parameters<typeof Badge>[0]['tone']>;
const HEALTH_TONE: Record<TokenHealth, Tone> = {
  valid: 'ok',
  expires_soon: 'warn',
  broken: 'bad',
  revoked: 'bad',
};

export default function Accounts() {
  const { state } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const sa = state.collectorServiceAccount ?? '';
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [saEmail, setSaEmail] = useState('');
  const [saLabel, setSaLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listAccounts()
      .then(setAccounts)
      .catch((e: unknown) => toast(String(e), 'error'));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (sa && !saEmail) setSaEmail(sa);
  }, [sa, saEmail]);

  const connectBanner = new URLSearchParams(window.location.search).get('connect');

  const run = async (fn: () => Promise<unknown>, okMsg?: string) => {
    setBusy(true);
    try {
      await fn();
      await load();
      if (okMsg) toast(okMsg, 'success');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    const { url } = await api.connectStart();
    window.location.href = url;
  };

  const remove = async (a: Account) => {
    if (
      await confirm({
        title: `Remove ${a.displayName}?`,
        message: 'Its stored credentials are deleted. Collected data in BigQuery is kept.',
        confirmLabel: 'Remove',
        danger: true,
      })
    ) {
      void run(() => api.deleteAccount(a.id), 'Account removed');
    }
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Connect the Google accounts whose Search Console properties you want to collect."
        actions={
          <Button variant="primary" onClick={() => void connect()}>
            + Connect Google account
          </Button>
        }
      />

      {connectBanner === 'success' && (
        <p className="mb-3 text-sm text-ok">Account connected — properties discovered below.</p>
      )}
      {connectBanner === 'denied' && (
        <p className="mb-3 text-sm text-bad">Connection was cancelled.</p>
      )}

      {!accounts ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Type</Th>
              <Th>Email</Th>
              <Th>Token health</Th>
              <Th>Last success</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2/50">
                <Td className="font-medium">{a.displayName}</Td>
                <Td>{a.type === 'oauth' ? 'OAuth' : 'Service account'}</Td>
                <Td className="text-muted">{a.email ?? '—'}</Td>
                <Td>
                  <Badge tone={HEALTH_TONE[a.tokenHealth]}>{a.tokenHealth}</Badge>
                </Td>
                <Td className="text-muted">
                  {a.lastSuccessAt ? new Date(a.lastSuccessAt).toLocaleString() : '—'}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => api.discover(a.id), 'Discovery complete')}
                    >
                      Discover
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => api.checkHealth(a.id))}
                    >
                      Check health
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void remove(a)}
                    >
                      Remove
                    </Button>
                  </div>
                </Td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr>
                <Td className="px-3 py-6 text-muted">
                  No accounts yet — connect a Google account or register the service account below.
                </Td>
              </tr>
            )}
          </tbody>
        </Table>
      )}

      <Card className="mt-5" title="Service-account access">
        <p className="text-sm text-muted">
          For clients who can&apos;t share an OAuth login: add <strong>this</strong> service-account
          email as a user (Restricted is enough) on their Search Console property, then register it.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <code className="rounded bg-surface-2 px-2 py-1 text-sm">{sa || '…'}</code>
          <Button size="sm" disabled={!sa} onClick={() => void navigator.clipboard.writeText(sa)}>
            Copy
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="service account email">
            <TextInput
              className="w-96"
              value={saEmail}
              onChange={(e) => setSaEmail(e.target.value)}
            />
          </Field>
          <Field label="label">
            <TextInput value={saLabel} onChange={(e) => setSaLabel(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            disabled={busy || !saEmail}
            onClick={() =>
              void run(() => api.addServiceAccount(saEmail, saLabel), 'Service account registered')
            }
          >
            Register
          </Button>
        </div>
      </Card>
    </div>
  );
}
