import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth';

export function Login() {
  const { state, refresh } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The GSI client script (`async defer` in index.html) usually loads AFTER /api/config resolves,
  // so `window.google` can be undefined on first render. Poll until it's ready, then init — otherwise
  // the sign-in button never renders and a first-time user is stranded.
  const [gsiReady, setGsiReady] = useState<boolean>(() => Boolean(window.google));

  useEffect(() => {
    if (gsiReady) return;
    const t = setInterval(() => {
      if (window.google) {
        setGsiReady(true);
        clearInterval(t);
      }
    }, 100);
    return () => clearInterval(t);
  }, [gsiReady]);

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

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-4 text-fg">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-accent text-lg font-bold text-accent-fg">
          CV
        </div>
        <h1 className="text-xl font-semibold">ConsoleVault</h1>
        <p className="mt-1 text-sm text-muted">Sign in with an authorized admin Google account.</p>
        <div className="mt-6 flex justify-center" ref={buttonRef} />
        {(!state.googleClientId || !gsiReady) && (
          <p className="mt-3 text-sm text-muted">Loading sign-in…</p>
        )}
        {error && <p className="mt-3 text-sm text-bad">{error}</p>}
      </div>
    </div>
  );
}
