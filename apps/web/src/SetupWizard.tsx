/**
 * First-run setup wizard. Shown before login when the Web OAuth client isn't provisioned yet
 * (`/api/config` → needsSetup). It can't do the Console clicks for you (Google doesn't expose them),
 * but it removes all the guesswork: it shows the exact copy-paste values this deployment needs (its
 * own redirect URI + JS origin), deep-links into the right Console pages, and tells you the one
 * command to finish. Read-only and safe — it never writes a secret; provisioning happens in your
 * own deploy context via `./setup.sh`.
 */

import { useState } from 'react';
import { useAuth } from './auth';
import { Button, Card, CopyField, cx, Step } from './components/ui';

function projectFromSa(sa?: string): string | null {
  // sa-collector@<project>.iam.gserviceaccount.com
  const m = sa?.match(/@([^.]+)\.iam\.gserviceaccount\.com$/);
  return m?.[1] ?? null;
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
            <Step n={1} title="Create the OAuth app">
              <a
                className="text-accent hover:underline"
                href={`https://console.cloud.google.com/auth/overview${q}`}
                target="_blank"
                rel="noreferrer"
              >
                Google Auth Platform
              </a>{' '}
              → <strong>Get started</strong>. Give it any app name and your email, and choose
              audience <strong>External</strong> (or <strong>Internal</strong> if this project is
              in a Workspace org — then skip step 2).
            </Step>

            <Step n={2} title="Publish the app, or Google will block your sign-in">
              Under{' '}
              <a
                className="text-accent hover:underline"
                href={`https://console.cloud.google.com/auth/audience${q}`}
                target="_blank"
                rel="noreferrer"
              >
                Audience
              </a>
              , click <strong>Publish app</strong>. Skip this and sign-in fails with “has not
              completed the Google verification process”. Staying in <em>Testing</em> with yourself
              as a test user also works, but Google then expires your login every 7&nbsp;days.
              Unverified is fine — you&apos;ll click <strong>Continue</strong> past a notice.
            </Step>

            <Step n={3} title="Create a Web OAuth client with these exact values">
              <a
                className="text-accent hover:underline"
                href={`https://console.cloud.google.com/auth/clients${q}`}
                target="_blank"
                rel="noreferrer"
              >
                Clients
              </a>{' '}
              → <strong>Create client</strong> → <strong>Web application</strong>. Paste:
              <CopyField label="Authorized JavaScript origin" value={jsOrigin} />
              <CopyField label="Authorized redirect URI" value={redirectUri} />
              Then <strong>Download JSON</strong> for the client you just created.
            </Step>

            <Step n={4} title="Upload it by re-running setup">
              In your terminal, from the project folder, run{' '}
              <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">./setup.sh</code> again.
              It detects the missing client and asks for the JSON file you just downloaded, then
              stores it securely in Secret Manager. Nothing sensitive is ever pasted here.
            </Step>

            <Step n={5} title="Come back and sign in">
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
