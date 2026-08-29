/**
 * The token-health sweep's log line is a load-bearing interface, not a debug aid: the
 * `consolevault_token_health_alert` log-based metric selects on `jsonPayload.alert="token_health"`
 * (terraform/monitoring.tf) and the "account token unhealthy" alert policy counts that metric.
 * Rename the marker, drop the WARN, or start flagging BigQuery-export connections and the alert
 * either goes silent or cries wolf — with nothing failing at build time. These tests pin the
 * contract to the shape Terraform greps for.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  accounts: [] as Array<{ id: string; type: string; displayName: string; email?: string }>,
  /** account id → what its auth client does when probed. */
  probe: new Map<string, 'ok' | 'no-token' | Error>(),
  health: new Map<string, string>(),
  reset() {
    this.accounts = [];
    this.probe = new Map();
    this.health = new Map();
  },
}));

vi.mock('@consolevault/store', () => ({
  AccountRepository: class {
    async list() {
      return state.accounts;
    }
    async setTokenHealth(id: string, health: string) {
      state.health.set(id, health);
    }
  },
  SecretStore: class {},
  authClientForAccount: async (account: { id: string }) => {
    const outcome = state.probe.get(account.id) ?? 'ok';
    if (outcome instanceof Error) throw outcome;
    return { getAccessToken: async () => ({ token: outcome === 'ok' ? 'ya29.fake' : null }) };
  },
}));

const { tokenHealthSweep } = await import('./health.js');
const { SecretStore } = await import('@consolevault/store');

/** Captures what the sweep logged, in the shape Cloud Logging turns into `jsonPayload`. */
function recordingLogger() {
  const warns: Array<Record<string, unknown>> = [];
  const infos: Array<Record<string, unknown>> = [];
  return {
    warns,
    infos,
    logger: {
      warn: (obj: Record<string, unknown>) => warns.push(obj),
      info: (obj: Record<string, unknown>) => infos.push(obj),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sweep = (logger: unknown) => tokenHealthSweep(new SecretStore('p') as any, logger as any);

const account = (id: string, type = 'oauth') => ({ id, type, displayName: id, email: `${id}@x.com` });

describe('tokenHealthSweep', () => {
  beforeEach(() => state.reset());

  it('emits the alert:"token_health" marker the log-based metric filters on', async () => {
    state.accounts = [account('revoked-acct')];
    state.probe.set('revoked-acct', new Error('invalid_grant: Token has been expired or revoked.'));

    const { warns, logger } = recordingLogger();
    const result = await sweep(logger);

    expect(result).toEqual({ checked: 1, unhealthy: 1, skipped: 0 });
    expect(warns).toHaveLength(1);
    // The exact key/value the Terraform filter greps for.
    expect(warns[0]).toMatchObject({
      alert: 'token_health',
      accountId: 'revoked-acct',
      health: 'revoked',
    });
    expect(state.health.get('revoked-acct')).toBe('revoked');
  });

  it('stays silent — and persists health — when every account is valid', async () => {
    state.accounts = [account('a'), account('b', 'service_account')];

    const { warns, logger } = recordingLogger();
    const result = await sweep(logger);

    expect(result).toEqual({ checked: 2, unhealthy: 0, skipped: 0 });
    expect(warns).toEqual([]);
    expect([...state.health.values()]).toEqual(['valid', 'valid']);
  });

  it('classifies a token that refreshes to nothing as broken, not valid', async () => {
    state.accounts = [account('empty-token')];
    state.probe.set('empty-token', 'no-token');

    const { warns, logger } = recordingLogger();
    await sweep(logger);

    expect(warns[0]).toMatchObject({ alert: 'token_health', health: 'broken' });
  });

  it('skips BigQuery-export connections instead of alerting on their absent token', async () => {
    // These have no GSC credentials (SPEC §12); probing one throws, which would otherwise be
    // classified `broken` and page the operator on every sweep forever.
    state.accounts = [account('native', 'bigquery_export'), account('oauth-acct')];

    const { warns, logger } = recordingLogger();
    const result = await sweep(logger);

    expect(result).toEqual({ checked: 1, unhealthy: 0, skipped: 1 });
    expect(warns).toEqual([]);
    expect(state.health.has('native')).toBe(false);
  });

  it('logs a per-run summary so a sweep that probed nothing is distinguishable from a clean one', async () => {
    const { infos, logger } = recordingLogger();
    await sweep(logger);

    expect(infos).toContainEqual({
      event: 'token_health_sweep',
      checked: 0,
      unhealthy: 0,
      skipped: 0,
    });
  });
});
