import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth';

export function Login() {
  const { state, refresh } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The GSI client script (`async defer` in index.html) usually loads AFTER /api/config resolves,
  // so `window.google` can be undefined on first render. Poll until it's ready, then init.
  const [gsiReady, setGsiReady] = useState<boolean>(() => Boolean(window.google));
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hasGoogle = Boolean(state.googleClientId);

  useEffect(() => {
    if (!hasGoogle || gsiReady) return;
    const t = setInterval(() => {
      if (window.google) {
        setGsiReady(true);
        clearInterval(t);
      }
    }, 100);
    return () => clearInterval(t);
  }, [hasGoogle, gsiReady]);

  useEffect(() => {
    const g = window.google;
    if (!g || !gsiReady || !state.googleClientId || !buttonRef.current) return;
    g.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: (response) => {
        api
          .signIn(response.credential)
          .then(() => refresh())
          .catch((e: unknown) => {
            setError(
              e instanceof ApiError && e.status === 403
                ? 'This Google account is not an authorized admin.'
                : String(e),
            );
          });
      },
    });
    g.accounts.id.renderButton(buttonRef.current, { theme: 'outline', size: 'large', width: 280 });
  }, [state.googleClientId, gsiReady, refresh]);

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    api
      .passwordSignIn(password)
      .then(() => refresh())
      .catch((err: unknown) =>
        setError(
          err instanceof ApiError && err.status === 401 ? 'Incorrect password.' : String(err),
        ),
      )
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-4 text-fg">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent text-lg font-bold text-accent-fg">
          CV
        </div>
        <h1 className="text-xl font-semibold">ConsoleVault</h1>
        <p className="mt-1 text-sm text-muted">
          {hasGoogle
            ? 'Sign in with an authorized admin Google account.'
            : 'Sign in with your admin password.'}
        </p>

        {hasGoogle && (
          <>
            <div className="mt-6 flex justify-center" ref={buttonRef} />
            {!gsiReady && <p className="mt-3 text-sm text-muted">Loading sign-in…</p>}
          </>
        )}

        {hasGoogle && state.passwordLoginEnabled && (
          <div className="my-5 flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
            <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
          </div>
        )}

        {state.passwordLoginEnabled && (
          <form onSubmit={submitPassword} className={hasGoogle ? '' : 'mt-6'}>
            <input
              type="password"
              autoFocus={!hasGoogle}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              aria-label="Admin password"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={submitting || !password}
              className="mt-3 w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}
