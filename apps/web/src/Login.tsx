import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import { useAuth } from './auth';

export function Login() {
  const { state, refresh } = useAuth();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const g = window.google;
    if (!g || !state.googleClientId || !buttonRef.current) return;
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
  }, [state.googleClientId, refresh]);

  return (
    <div className="login">
      <div className="login-card">
        <h1>ConsoleVault</h1>
        <p>Sign in with an authorized admin Google account.</p>
        <div ref={buttonRef} />
        {!state.googleClientId && <p className="muted">Loading sign-in…</p>}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
}
