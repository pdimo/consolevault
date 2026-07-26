/**
 * First-run setup wizard. Shown before login when the Web OAuth client isn't provisioned yet
 * (`/api/config` → needsSetup). It can't do the Console clicks for you (Google doesn't expose them),
 * but it removes all the guesswork: it shows the exact copy-paste values this deployment needs (its
 * own redirect URI + JS origin), deep-links into the right Console pages, and tells you the one
 * command to finish. Read-only and safe — it never writes a secret; provisioning happens in your
 * own deploy context via `./setup.sh`.
 */

import { useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { Button, Card, cx } from './components/ui';

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function projectFromSa(sa?: string): string | null {
  // sa-collector@<project>.iam.gserviceaccount.com
  const m = sa?.match(/@([^.]+)\.iam\.gserviceaccount\.com$/);
  return m?.[1] ?? null;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  };
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs whitespace-nowrap">
          {value}
        </code>
        <Button size="sm" onClick={() => void copy()} className="shrink-0">
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-xs font-bold text-accent-fg">
        {n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <div className="mt-1 text-sm text-muted">{children}</div>
      </div>
    </div>
  );
}

export default function SetupWizard() {
  const { state, refresh } = useAuth();
  const [checking, setChecking] = useState(false);
  const jsOrigin = state.jsOrigin ?? window.location.origin;
  const redirectUri = state.redirectUri ?? `${window.location.origin}/api/oauth/callback`;
  const project = projectFromSa(state.collectorServiceAccount);
  const q = project ? `?project=${project}` : '';

  const recheck = async () => {
    setChecking(true);
    await refresh();
    setChecking(false);
  };

  return (
    <div className="min-h-screen bg-bg px-4 py-10 text-fg">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-base font-bold text-accent-fg">
            CV
          </span>
          <div>
            <h1 className="text-xl font-semibold">Finish setting up ConsoleVault</h1>
            <p className="text-sm text-muted">
              One-time OAuth setup. It takes ~5 minutes and you only do it once.
            </p>
          </div>
        </div>

        <Card>
          <p className="text-sm text-muted">
            ConsoleVault signs you in with your own Google account, so it needs a Google{' '}
            <strong>Web OAuth client</strong>. Google only lets you create that in the Cloud Console
            — but here are the exact values to paste, so there's no guesswork.
          </p>

          <div className="mt-5 flex flex-col gap-5">
            <Step n={1} title="Open the OAuth consent screen and add the scope">
              <a
                className="text-accent hover:underline"
                href={`https://console.cloud.google.com/auth/branding${q}`}
                target="_blank"
                rel="noreferrer"
              >
                Google Auth Platform → Branding
              </a>
              . Set an app name + support email. Under <strong>Data access</strong>, add this one
              read-only scope:
              <CopyField label="Scope" value={SCOPE} />
              Then under <strong>Audience</strong>, publish the app to{' '}
              <strong>“In production”</strong> (an <em>External</em> app left in “Testing” expires
              your login every 7&nbsp;days). Leaving it unverified is fine for single-admin use.
            </Step>

            <Step n={2} title="Create a Web OAuth client with these exact values">
              <a
                className="text-accent hover:underline"
                href={`https://console.cloud.google.com/apis/credentials${q}`}
                target="_blank"
                rel="noreferrer"
              >
                APIs &amp; Services → Credentials
              </a>{' '}
              → <strong>Create credentials → OAuth client ID → Web application</strong>. Paste:
              <CopyField label="Authorized JavaScript origin" value={jsOrigin} />
              <CopyField label="Authorized redirect URI" value={redirectUri} />
              Then <strong>Download JSON</strong> for the client you just created.
            </Step>

            <Step n={3} title="Upload it by re-running setup">
              In your terminal, from the project folder, run{' '}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">./setup.sh</code> again.
              It detects the missing client and asks for the JSON file you just downloaded, then
              stores it securely in Secret Manager. Nothing sensitive is ever pasted here.
            </Step>

            <Step n={4} title="Come back and sign in">
              Once setup finishes, click below — the sign-in screen appears and you can connect your
              Search Console accounts from the app.
            </Step>
          </div>

          <div className="mt-6 flex items-center gap-3 border-t border-line pt-4">
            <Button variant="primary" loading={checking} onClick={() => void recheck()}>
              I&apos;ve finished setup — check again
            </Button>
            <span className={cx('text-sm', state.needsSetup ? 'text-muted' : 'text-ok')}>
              {state.needsSetup ? 'Waiting for the Web client…' : 'Ready — reloading…'}
            </span>
          </div>
        </Card>

        {project && (
          <p className="mt-4 text-center text-xs text-muted">
            Prefer the service-account path (no consent screen)? Add{' '}
            <code className="rounded bg-surface-2 px-1 py-0.5">
              {state.collectorServiceAccount}
            </code>{' '}
            as a user on your Search Console property — see <code>docs/AUTH.md</code>.
          </p>
        )}
      </div>
    </div>
  );
}
