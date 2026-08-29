/**
 * Token-health sweep (SPEC §3 — the #1 operational risk). Probes every account's credentials,
 * persists tokenHealth, and emits a structured WARN log (`alert: "token_health"`) for any unhealthy
 * account. A log-based metric + Cloud Monitoring alert fire on that marker BEFORE a silent zero-row
 * day. Scheduled separately from the daily pipeline (more frequent).
 */

import type { FastifyBaseLogger } from 'fastify';
import { classifyTokenError } from '@consolevault/gsc';
import { AccountRepository, authClientForAccount, type SecretStore } from '@consolevault/store';
import type { TokenHealth } from '@consolevault/types';

export async function tokenHealthSweep(
  secretStore: SecretStore,
  logger: FastifyBaseLogger,
): Promise<{ checked: number; unhealthy: number; skipped: number }> {
  const accountRepo = new AccountRepository();
  const accounts = await accountRepo.list();
  let unhealthy = 0;
  let skipped = 0;

  for (const account of accounts) {
    // BigQuery-export connections have no GSC token to sweep (SPEC §12) — skip so they don't get
    // flagged unhealthy and trip a false token-health alert.
    if (account.type === 'bigquery_export') {
      skipped++;
      continue;
    }
    let health: TokenHealth;
    try {
      const client = await authClientForAccount(account, secretStore);
      const token = await client.getAccessToken();
      health = token?.token ? 'valid' : 'broken';
    } catch (err) {
      health = classifyTokenError(err);
    }
    await accountRepo.setTokenHealth(account.id, health);
    if (health !== 'valid') {
      unhealthy++;
      logger.warn(
        {
          alert: 'token_health',
          accountId: account.id,
          account: account.displayName,
          email: account.email ?? null,
          health,
        },
        `Account ${account.displayName} token health is ${health}`,
      );
    }
  }
  const checked = accounts.length - skipped;
  // A sweep that probed nothing returns 200 exactly like a clean one, so the HTTP log alone can't
  // tell "all healthy" from "the account list came back empty". Emit the count every run so the
  // sweep's own liveness is observable, and so `checked: 0` is greppable.
  logger.info({ event: 'token_health_sweep', checked, unhealthy, skipped }, 'token-health sweep');
  return { checked, unhealthy, skipped };
}
