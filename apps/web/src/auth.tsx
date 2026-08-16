import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';

interface AuthState {
  status: 'loading' | 'authed' | 'anon';
  email?: string;
  googleClientId?: string;
  passwordLoginEnabled?: boolean;
  collectorServiceAccount?: string;
  exportReaderServiceAccounts?: string[];
  needsSetup?: boolean;
  redirectUri?: string;
  jsOrigin?: string;
  projectId?: string;
  error?: string;
}

interface AuthContextValue {
  state: AuthState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const refresh = async () => {
    try {
      const cfg = await api.config();
      const cfgBits = {
        collectorServiceAccount: cfg.collectorServiceAccount,
        passwordLoginEnabled: cfg.passwordLoginEnabled,
        needsSetup: cfg.needsSetup,
        redirectUri: cfg.redirectUri,
        jsOrigin: cfg.jsOrigin,
        projectId: cfg.projectId,
        ...(cfg.googleClientId ? { googleClientId: cfg.googleClientId } : {}),
        ...(cfg.exportReaderServiceAccounts
          ? { exportReaderServiceAccounts: cfg.exportReaderServiceAccounts }
          : {}),
      };
      try {
        const me = await api.me();
        setState({ status: 'authed', email: me.email, ...cfgBits });
      } catch {
        setState({ status: 'anon', ...cfgBits });
      }
    } catch (e) {
      setState({ status: 'anon', error: String(e) });
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const signOut = async () => {
    await api.logout();
    setState((s) => ({
      status: 'anon',
      ...(s.googleClientId ? { googleClientId: s.googleClientId } : {}),
    }));
  };

  return (
    <AuthContext.Provider value={{ state, refresh, signOut }}>{children}</AuthContext.Provider>
  );
}
