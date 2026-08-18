import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Account, TokenHealth } from '@consolevault/types';
import { api } from './api';
import { useAuth } from './auth';
import { useConfirm, useToast } from './components/feedback';
import {
  Badge,
  Button,
  Card,
  cx,
  EmptyState,
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
  const navigate = useNavigate();
  const sa = state.collectorServiceAccount ?? '';
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [saEmail, setSaEmail] = useState('');
  const [saLabel, setSaLabel] = useState('Search Console');
  const [setupOpen, setSetupOpen] = useState(false);
  const [showExport, setShowExport] = useState(false);
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
  // This deployment's own collector — materialised server-side, so it's always in the list.
  const builtInAccount = accounts?.find((a) => a.builtIn);

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

  // With a Web client already provisioned this goes straight to Google; otherwise the guided
  // setup does the Console walkthrough first. Errors are caught — a bare `void connect()` turned
  // a 409 from /api/oauth/start into a silent unhandled rejection with no feedback at all.
  const connect = async () => {
    if (!state.googleClientId) {
      navigate('/accounts/connect-google');
      return;
    }
    try {
      const { url } = await api.connectStart();
      window.location.href = url;
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  const copy = (v: string) => {
    void navigator.clipboard.writeText(v);
    toast('Copied', 'success');
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

      {!accounts ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon="⚿"
          title="No connections yet"
          description="Pick one of the three ways to feed Search Console data in, below."
        />
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
                  ) : a.builtIn && (a.propertyCount ?? 0) === 0 ? (
                    // Nothing has granted it access yet, so "valid" would be a claim we haven't
                    // tested — the token health of an impersonated SA is asserted, not measured.
                    <Badge tone="warn">awaiting access</Badge>
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
                    {a.builtIn ? (
                      <Button size="sm" onClick={() => setSetupOpen(true)}>
                        Set up
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        loading={busyKey === `rm:${a.id}`}
                        onClick={() => void remove(a)}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-muted">
        Add a connection
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Google account">
          <p className="text-sm text-muted">
            Sign in with a Google account and collect every Search Console property it can see.
            Best when you own the properties. Needs a one-time setup in the Cloud Console —
            we walk you through it.
          </p>
          <Button
            className="mt-3"
            variant="primary"
            onClick={() => navigate('/accounts/connect-google')}
          >
            Connect a Google account
          </Button>
        </Card>

        <Card title="Service account">
          <p className="text-sm text-muted">
            No Console setup at all. Grant this deployment&apos;s collector access in Search
            Console and it picks up every property that grants it — the usual choice for agencies
            managing clients&apos; properties.
          </p>
          <Button className="mt-3" variant="primary" onClick={() => setSetupOpen(true)}>
            Show me how
          </Button>
        </Card>

        <Card title="BigQuery export">
          <p className="text-sm text-muted">
            Already running Google&apos;s native Bulk Export? Point ConsoleVault at that dataset
            and get the whole reporting layer with no API collection and no row ceiling.
          </p>
          <Button className="mt-3" onClick={() => setShowExport((v) => !v)}>
            {showExport ? 'Hide' : 'Connect an export'}
          </Button>
        </Card>
      </div>

      {setupOpen && (
        <Card className="mt-5" title="Give the collector access to your properties">
          <p className="text-sm text-muted">
            Add this email as a user on each Search Console property you manage —{' '}
            <strong>Restricted</strong> is enough. It&apos;s already registered as a connection
            above; nothing else to set up here.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="rounded bg-surface-2 px-2 py-1 text-sm">{sa || '…'}</code>
            <Button size="sm" disabled={!sa} onClick={() => copy(sa)}>
              Copy
            </Button>
          </div>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>
              Open{' '}
              <a
                className="text-accent underline"
                href="https://search.google.com/search-console"
                target="_blank"
                rel="noreferrer"
              >
                Search Console ↗
              </a>{' '}
              and pick a property.
            </li>
            <li>
              <strong>Settings → Users and permissions → Add user</strong>, paste the email above,
              permission <strong>Restricted</strong>.
            </li>
            <li>
              Repeat for each property, then come back and press{' '}
              <strong>Check for properties</strong>.
            </li>
          </ol>
          <div className="mt-4 flex gap-2">
            {builtInAccount && (
              <Button
                variant="primary"
                disabled={busy}
                loading={busyKey === `disc:${builtInAccount.id}`}
                onClick={() =>
                  void run(
                    `disc:${builtInAccount.id}`,
                    () => api.discover(builtInAccount.id),
                    (r) =>
                      toast(
                        r.count === 0
                          ? 'No properties yet — check the email was added in Search Console'
                          : `Found ${r.count} ${r.count === 1 ? 'property' : 'properties'}`,
                        r.count === 0 ? 'info' : 'success',
                      ),
                  )
                }
              >
                Check for properties
              </Button>
            )}
            <Button onClick={() => setSetupOpen(false)}>Done</Button>
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-xs text-muted">
              Advanced — register a different service account
            </summary>
            <div className="mt-2">
              <p className="text-xs text-muted">
                Only needed if you want to collect via a service account from another project.
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-3">
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
                  disabled={busy || !saEmail || saEmail === sa}
                  loading={busyKey === 'sa-register'}
                  onClick={() =>
                    void run(
                      'sa-register',
                      async () => {
                        const account = await api.addServiceAccount(saEmail, saLabel);
                        return api.discover(account.id);
                      },
                      (r) => {
                        toast(
                          `Registered — found ${r.count} ${r.count === 1 ? 'property' : 'properties'}`,
                          'success',
                        );
                        setSaEmail('');
                        setSaLabel('Search Console');
                      },
                    )
                  }
                >
                  Register
                </Button>
              </div>
            </div>
          </details>
        </Card>
      )}

      <Card
        className={cx('mt-5', !showExport && 'hidden')}
        title="Connect a BigQuery export"
      >
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
