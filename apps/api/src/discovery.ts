/**
 * Discovery + token-health orchestration (Stage 1).
 *
 * Runs Sites:list for an account and upserts the discovered properties. Credential resolution is
 * shared with the collector via `authClientForAccount` in `@consolevault/store`. No
 * search-analytics collection here (CLAUDE.md hard rule 3).
 */

import {
  checkOAuthTokenHealth,
  classifyTokenError,
  listSites,
  type OAuthClientConfig,
} from '@consolevault/gsc';
import { authClientForAccount, SECRET_IDS } from '@consolevault/store';
import type { Account, TokenHealth } from '@consolevault/types';
import { accountRepo, propertyRepo, secretStore } from './deps.js';
import { HttpError } from './errors.js';

async function requireAccount(accountId: string): Promise<Account> {
  const account = await accountRepo.get(accountId);
  if (!account) throw new HttpError(404, 'Account not found');
  return account;
}

/** Run Sites:list for an account and upsert the discovered properties. */
export async function discoverForAccount(accountId: string): Promise<{ count: number }> {
  const account = await requireAccount(accountId);
  const authClient = await authClientForAccount(account, secretStore);
  const sites = await listSites(authClient);
  const now = new Date().toISOString();
  const count = await propertyRepo.upsertFromDiscovery(accountId, sites, now);
  await accountRepo.update(accountId, { lastSuccessAt: now });
  return { count };
}

/** Probe an account's credentials and persist its token health. */
export async function checkAccountHealth(accountId: string): Promise<TokenHealth> {
  const account = await requireAccount(accountId);
  let health: TokenHealth;
  if (account.type === 'oauth') {
    const config = JSON.parse(
      await secretStore.getSecret(SECRET_IDS.oauthClientConfig),
    ) as OAuthClientConfig;
    const refreshToken = await secretStore.getSecret(SECRET_IDS.oauthRefresh(account.id));
    health = await checkOAuthTokenHealth(config, refreshToken);
  } else {
    try {
      const client = await authClientForAccount(account, secretStore);
      const token = await client.getAccessToken();
      health = token?.token ? 'valid' : 'broken';
    } catch (err) {
      health = classifyTokenError(err);
    }
  }
  await accountRepo.setTokenHealth(accountId, health);
  return health;
}
