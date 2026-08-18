/**
 * Connect a Google account — the guided path through the one-time Google Cloud setup.
 *
 * Google won't let an app create its own OAuth client or publish its own consent screen, so this
 * can't be automated. What it can do is remove every guess: deep-link the exact Console page
 * (pre-scoped to this project), show the exact values to paste, and be honest about the one step
 * that actually blocks sign-in.
 *
 * Two things this deliberately does NOT say, both learned from a real install:
 *  - It doesn't tell you to add the webmasters.readonly scope under Data Access. The scope travels
 *    in the authorization request (see apps/api/src/oauth.ts), so registering it changes nothing
 *    unless you later submit the app for Google verification. The old instruction sent people
 *    hunting for a control that isn't on the page it linked to.
 *  - It doesn't tell you to click "Advanced → Continue" past a scary warning. A published app
 *    requesting only this sensitive scope shows a plain notice with a Continue button.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './api';
import { useAuth } from './auth';
import { useToast } from './components/feedback';
import { Button, Card, CopyField, PageHeader, Step } from './components/ui';

const TOTAL_STEPS = 4;

/** Console links, scoped to this deployment's project so the user lands in the right place. */
function links(projectId?: string) {
  const q = projectId ? `?project=${projectId}` : '';
  return {
    overview: `https://console.cloud.google.com/auth/overview${q}`,
    audience: `https://console.cloud.google.com/auth/audience${q}`,
    clients: `https://console.cloud.google.com/auth/clients${q}`,
    dataAccess: `https://console.cloud.google.com/auth/scopes${q}`,
  };
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="text-accent underline" href={href} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  );
}

export default function ConnectGoogle() {
  const { state, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [clientJson, setClientJson] = useState('');
  const [busy, setBusy] = useState(false);

  const url = links(state.projectId);
  const jsOrigin = state.jsOrigin ?? window.location.origin;
  const redirectUri = state.redirectUri ?? `${window.location.origin}/api/oauth/callback`;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setClientJson(String(reader.result ?? ''));
    reader.onerror = () => toast('Could not read that file', 'error');
    reader.readAsText(file);
  };

  // Save the client, then go straight into Google's authorization screen — the upload is never
  // the finish line, connecting is.
  const finish = async () => {
    setBusy(true);
    try {
      await api.uploadOAuthClient(clientJson);
      await refresh(); // /api/config now reports googleClientId; without this the UI stays stale
      const { url: authUrl } = await api.connectStart();
      window.location.href = authUrl;
    } catch (e: unknown) {
      toast(String(e), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Connect a Google account"
        description="A one-time setup in the Google Cloud Console, then every Search Console property on that login collects automatically."
        actions={
          <Button onClick={() => navigate('/accounts')} disabled={busy}>
            Cancel
          </Button>
        }
      />

      <p className="mb-4 text-sm text-muted">
        Step {step} of {TOTAL_STEPS}
      </p>

      <Card>
        {step === 1 && (
          <Step n={1} title="Create the OAuth app">
            <p>
              Open <ExternalLink href={url.overview}>Google Auth Platform</ExternalLink> and click{' '}
              <strong>Get started</strong>. You&apos;ll be asked for four things:
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>
                <strong>App Information</strong> — any app name (it&apos;s only shown to you) and
                your email as the support contact.
              </li>
              <li>
                <strong>Audience</strong> — choose <strong>External</strong>. Pick{' '}
                <strong>Internal</strong> only if this project belongs to a Google Workspace
                organisation and you&apos;ll sign in with an account inside it — then you can skip
                step 2 entirely.
              </li>
              <li>
                <strong>Contact Information</strong> — your email again.
              </li>
              <li>
                Agree to the policy, then <strong>Create</strong>.
              </li>
            </ul>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted">
                Do I need to add the Search Console scope under Data Access?
              </summary>
              <p className="mt-2 text-xs">
                No. ConsoleVault requests <code>webmasters.readonly</code> as part of the sign-in
                itself, so the consent screen shows it whether or not it&apos;s registered here.
                Adding it under <ExternalLink href={url.dataAccess}>Data Access</ExternalLink> only
                matters if you ever submit this app for Google verification — which self-deploying
                avoids by design.
              </p>
            </details>
          </Step>
        )}

        {step === 2 && (
          <Step n={2} title="Let yourself in">
            <p>
              This is the step that trips people up. A brand-new app is in <em>Testing</em> with no
              users, and Google will refuse to let you sign in:
            </p>
            <p className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-bad">
              Access blocked: … has not completed the Google verification process
              <br />
              Error 403: access_denied
            </p>
            <p className="mt-3">
              Open <ExternalLink href={url.audience}>Audience</ExternalLink> and do{' '}
              <strong>one</strong> of these:
            </p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                <strong>Publish app</strong> — recommended. Your sign-in keeps working
                indefinitely. The app stays <em>unverified</em>, which is fine for your own data:
                at sign-in Google shows a notice that it hasn&apos;t verified the app, and you
                click <strong>Continue</strong>.
              </li>
              <li>
                <strong>Add yourself under Test users</strong> — works, but Google expires the
                login after <strong>7 days</strong> and collection stops silently. Fine for a quick
                look, not for real use.
              </li>
            </ul>
          </Step>
        )}

        {step === 3 && (
          <Step n={3} title="Create the Web client">
            <p>
              Open <ExternalLink href={url.clients}>Clients</ExternalLink> →{' '}
              <strong>Create client</strong> → application type <strong>Web application</strong>.
              Name it anything. Then paste these two values into the matching boxes:
            </p>
            <CopyField label="Authorized JavaScript origin" value={jsOrigin} />
            <CopyField label="Authorized redirect URI" value={redirectUri} />
            <p className="mt-3">
              Click <strong>Create</strong>, then <strong>Download JSON</strong> from the client you
              just made. Google notes that changes can take a few minutes to take effect.
            </p>
          </Step>
        )}

        {step === 4 && (
          <Step n={4} title="Upload it and connect">
            <p>
              Choose the JSON file you downloaded. It&apos;s stored in this deployment&apos;s Secret
              Manager and never leaves your project.
            </p>
            <div className="mt-3">
              <input
                type="file"
                accept=".json,application/json"
                onChange={onFile}
                className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:text-fg"
              />
              {clientJson && <p className="mt-2 text-sm text-ok">✓ File loaded — ready to connect.</p>}
            </div>
            <p className="mt-3 text-xs">
              Connecting takes you to Google&apos;s sign-in. Approve the Search Console permission
              and you&apos;ll land back here with your properties discovered.
            </p>
          </Step>
        )}

        <div className="mt-6 flex items-center justify-between border-t border-line pt-4">
          <Button onClick={() => setStep((s) => s - 1)} disabled={step === 1 || busy}>
            ← Back
          </Button>
          {step < TOTAL_STEPS ? (
            <Button variant="primary" onClick={() => setStep((s) => s + 1)}>
              I&apos;ve done this →
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={!clientJson || busy}
              loading={busy}
              onClick={() => void finish()}
            >
              Connect to Google
            </Button>
          )}
        </div>
      </Card>

      <p className="mt-4 text-center text-sm text-muted">
        Don&apos;t want to do any of this? The{' '}
        <button className="text-accent underline" onClick={() => navigate('/accounts')}>
          service-account path
        </button>{' '}
        needs no Console setup at all — you grant one email access in Search Console instead.
      </p>
    </div>
  );
}
