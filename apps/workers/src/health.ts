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
): Promise<{ checked: number; unhealthy: number }> {
  const accountRepo = new AccountRepository();
  const accounts = await accountRepo.list();
  let unhealthy = 0;

  for (const account of accounts) {
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
  return { checked: accounts.length, unhealthy };
}
