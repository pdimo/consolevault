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
  const [saLabel, setSaLabel] = useState('Search Console');
  const [showOAuthSetup, setShowOAuthSetup] = useState(false);
  const [clientJson, setClientJson] = useState('');
  const [expDataset, setExpDataset] = useState('searchconsole');
  const [expProject, setExpProject] = useState('');
  const [expLabel, setExpLabel] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const busy = busyKey !== null;

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

  // `key` drives the per-button spinner; `onOk` fires after success so each action can report a
  // specific result (e.g. the token-health verdict, or how many properties were discovered).
  const run = async <T,>(key: string, fn: () => Promise<T>, onOk?: (r: T) => void) => {
    setBusyKey(key);
    try {
      const result = await fn();
      await load();
      onOk?.(result);
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setBusyKey(null);
    }
  };

  const healthTone = (h: TokenHealth): 'success' | 'info' | 'error' =>
    h === 'valid' ? 'success' : h === 'expires_soon' ? 'info' : 'error';
  const healthMsg = (h: TokenHealth): string =>
    h === 'valid'
      ? 'Token is healthy'
      : h === 'expires_soon'
        ? 'Token expires soon — reconnect this account soon'
        : h === 'broken'
          ? 'Token is broken — reconnect this account'
          : 'Token was revoked — reconnect this account';

  const connect = async () => {
    // No Web OAuth client yet (e.g. a bootstrap deployment) → guide the admin to add one in-app.
    if (!state.googleClientId) {
      setShowOAuthSetup(true);
      return;
    }
    const { url } = await api.connectStart();
    window.location.href = url;
  };

  const saveOAuthClient = async () => {
    setBusyKey('oauth-client');
    try {
      await api.uploadOAuthClient(clientJson);
      const { url } = await api.connectStart(); // straight into Google authorization
      window.location.href = url;
    } catch (e) {
      toast(String(e), 'error');
      setBusyKey(null);
    }
  };

  const remove = async (a: Account) => {
    const n = a.propertyCount ?? 0;
    const props = `${n} propert${n === 1 ? 'y' : 'ies'}`;
    const message =
      a.type === 'bigquery_export'
        ? `This connection imports ${props}. Removing it deletes those properties and their reports (the underlying BigQuery export dataset is untouched).`
        : n > 0
          ? `This account reaches ${props}. Its credentials, task queue, and pending jobs are deleted; collected data in BigQuery is kept. Any property only reachable by this account will stop collecting.`
          : 'Its stored credentials, task queue, and pending jobs are deleted. Collected data in BigQuery is kept.';
    if (
      await confirm({
        title: `Remove ${a.displayName}?`,
        message,
        confirmLabel: 'Remove',
        danger: true,
      })
    ) {
      void run(
        `rm:${a.id}`,
        () => api.deleteAccount(a.id),
        () => toast('Connection removed', 'success'),
      );
    }
  };

  return (
    <div>
      <PageHeader
        title="Connections"
        description="Everything feeding Search Console data in — Google accounts, service accounts, and BigQuery exports. Each connection collects its own properties."
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

      {showOAuthSetup && (
        <Card className="mb-4" title="Enable Google sign-in (one-time)">
          <p className="text-sm text-muted">
            To connect a Google account by sign-in, create a <strong>Web</strong> OAuth client in
            the Google Cloud Console (Google only allows this in the Console), then paste its JSON
            here.
          </p>
          <p className="mt-2 text-xs text-muted">
            This is a <strong>one-time</strong> setup. Afterwards, “Connect Google account” goes
            straight to the Google login and adds the account with all its properties.
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">
            <li>
              Set up the{' '}
              <a
                className="text-accent underline"
                href="https://console.cloud.google.com/apis/credentials/consent"
                target="_blank"
                rel="noreferrer"
              >
                OAuth consent screen
              </a>{' '}
              (one-time): choose <strong>External</strong>, add your email, add the scope{' '}
              <code className="rounded bg-surface-2 px-1 text-xs">…/auth/webmasters.readonly</code>,
              then <strong>Publish</strong> (staying “unverified” is fine).
            </li>
            <li>
              Open{' '}
              <a
                className="text-accent underline"
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
              >
                APIs &amp; Services → Credentials
              </a>{' '}
              → <strong>Create credentials → OAuth client ID → Web application</strong>.
            </li>
            <li>
              Add these two values, then <strong>Create</strong> and{' '}
              <strong>download the JSON</strong>:
              <div className="mt-1 space-y-1">
                <div className="text-xs text-muted">Authorized JavaScript origin</div>
                <code className="block rounded bg-surface-2 px-2 py-1 text-xs">
                  {state.jsOrigin}
                </code>
                <div className="text-xs text-muted">Authorized redirect URI</div>
                <code className="block rounded bg-surface-2 px-2 py-1 text-xs">
                  {state.redirectUri}
                </code>
              </div>
            </li>
            <li>Paste the downloaded JSON below.</li>
          </ol>
          <textarea
            value={clientJson}
            onChange={(e) => setClientJson(e.target.value)}
            placeholder='{ "web": { "client_id": "…", "client_secret": "…" } }'
            className="mt-3 h-28 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs outline-none focus:border-accent"
          />
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              disabled={!clientJson || busy}
              loading={busyKey === 'oauth-client'}
              onClick={() => void saveOAuthClient()}
            >
              Enable &amp; connect
            </Button>
            <Button onClick={() => setShowOAuthSetup(false)}>Cancel</Button>
          </div>
        </Card>
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
              <Th className="text-center">Properties</Th>
              <Th>Token health</Th>
              <Th>Last success</Th>
              <Th className="text-right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2/50">
                <Td className="font-medium">{a.displayName}</Td>
                <Td>
                  {a.type === 'oauth'
                    ? 'OAuth'
                    : a.type === 'bigquery_export'
                      ? 'BigQuery export'
                      : 'Service account'}
                </Td>
                <Td className="text-muted">
                  {a.email ??
                    (a.exportDataset
                      ? `${a.exportDataset.projectId}.${a.exportDataset.datasetId}`
                      : '—')}
                </Td>
                <Td className="text-center tabular-nums">{a.propertyCount ?? 0}</Td>
                <Td>
                  {a.type === 'bigquery_export' ? (
                    <Badge tone="ok">import</Badge>
                  ) : (
                    <Badge tone={HEALTH_TONE[a.tokenHealth]}>{a.tokenHealth}</Badge>
                  )}
                </Td>
                <Td className="text-muted">
                  {a.lastSuccessAt ? new Date(a.lastSuccessAt).toLocaleString() : '—'}
                </Td>
                <Td>
                  <div className="flex justify-end gap-1.5">
                    <Button
                      size="sm"
                      disabled={busy}
                      loading={busyKey === `disc:${a.id}`}
                      onClick={() =>
                        void run(
                          `disc:${a.id}`,
                          () => api.discover(a.id),
                          (r) =>
                            toast(
                              `Discovered ${r.count} ${r.count === 1 ? 'property' : 'properties'}`,
                              'success',
                            ),
                        )
                      }
                    >
                      Discover
                    </Button>
                    {a.type !== 'bigquery_export' && (
                      <Button
                        size="sm"
                        disabled={busy}
                        loading={busyKey === `health:${a.id}`}
                        onClick={() =>
                          void run(
                            `health:${a.id}`,
                            () => api.checkHealth(a.id),
                            (r) => toast(healthMsg(r.tokenHealth), healthTone(r.tokenHealth)),
                          )
                        }
                      >
                        Check health
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      loading={busyKey === `rm:${a.id}`}
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
                <Td className="px-3 py-6 text-muted">No connections yet — add one below.</Td>
              </tr>
            )}
          </tbody>
        </Table>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
        Add a connection
      </h2>
      <Card title="Service account (recommended for agencies)">
        <p className="text-sm text-muted">
          <strong>1.</strong> In Search Console, add the email below as a user (Restricted is
          enough) on each property you manage. <strong>2.</strong> Register it here —{' '}
          <strong>just once</strong>: it then collects every property that has granted it access, so
          you don&apos;t add a separate account per property.
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
            loading={busyKey === 'sa-register'}
            onClick={() =>
              void run(
                'sa-register',
                () => api.addServiceAccount(saEmail, saLabel),
                () => {
                  toast('Service account registered', 'success');
                  setSaLabel('');
                },
              )
            }
          >
            Register
          </Button>
        </div>
      </Card>

      <Card className="mt-5" title="Connect a BigQuery export">
        <p className="text-sm text-muted">
          Already streaming Search Console data into BigQuery with Google&apos;s native{' '}
          <strong>Bulk Export</strong>? Point ConsoleVault at that dataset to get the full reporting
          layer on top of it — <strong>no API collection, no backfill limit</strong>. These
          properties are read-only imports. Leave the project blank to use this deployment&apos;s
          project. Exports in <strong>any BigQuery region</strong> work — ConsoleVault reports on
          each in its own region.
        </p>
        {(state.exportReaderServiceAccounts?.length ?? 0) > 0 && (
          <div className="mt-2 text-sm text-muted">
            Connecting a <strong>client-owned</strong> export? First have them grant{' '}
            <strong>BigQuery Data Viewer</strong> on the dataset to:
            <div className="mt-1 flex flex-wrap gap-2">
              {state.exportReaderServiceAccounts!.map((sa) => (
                <code key={sa} className="rounded bg-surface-2 px-2 py-0.5 text-xs">
                  {sa}
                </code>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <Field label="dataset id">
            <TextInput value={expDataset} onChange={(e) => setExpDataset(e.target.value)} />
          </Field>
          <Field label="project id (optional)">
            <TextInput
              className="w-72"
              placeholder="this deployment's project"
              value={expProject}
              onChange={(e) => setExpProject(e.target.value)}
            />
          </Field>
          <Field label="label (optional)">
            <TextInput value={expLabel} onChange={(e) => setExpLabel(e.target.value)} />
          </Field>
          <Button
            variant="primary"
            disabled={busy || !expDataset.trim()}
            loading={busyKey === 'exp-register'}
            onClick={() =>
              void run(
                'exp-register',
                async () => {
                  const account = await api.addBigQueryExport({
                    name: expLabel.trim(),
                    projectId: expProject.trim(),
                    datasetId: expDataset.trim(),
                  });
                  return api.discover(account.id);
                },
                (r) => {
                  toast(
                    `Export connected — imported ${r.count} ${r.count === 1 ? 'property' : 'properties'}`,
                    'success',
                  );
                  setExpLabel('');
                  setExpProject('');
                },
              )
            }
          >
            Connect export
          </Button>
        </div>
      </Card>
    </div>
  );
}
