import { useState } from 'react';
import Accounts from './Accounts';
import Properties from './Properties';

/** Stage 1 single-admin UI: accounts (token-health) + properties (include/exclude). */
export default function App() {
  const [tab, setTab] = useState<'accounts' | 'properties'>('accounts');
  // Bumped whenever discovery runs so the Properties view reloads.
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 1000 }}>
      <h1>ConsoleVault</h1>
      <nav style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <button onClick={() => setTab('accounts')} disabled={tab === 'accounts'}>
          Accounts
        </button>
        <button onClick={() => setTab('properties')} disabled={tab === 'properties'}>
          Properties
        </button>
      </nav>
      {tab === 'accounts' ? (
        <Accounts onChanged={() => setReloadKey((k) => k + 1)} />
      ) : (
        <Properties reloadKey={reloadKey} />
      )}
    </main>
  );
}
