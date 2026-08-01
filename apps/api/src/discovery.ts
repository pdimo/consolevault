/**
 * Discovery + token-health orchestration (Stage 1).
 *
 * Runs Sites:list for an account and upserts the discovered properties. Credential resolution is
 * shared with the collector via `authClientForAccount` in `@consolevault/store` (which uses the
 * client that minted each account's token — Desktop helper vs in-UI web flow). No search-analytics
 * collection here (CLAUDE.md hard rule 3).
 */

import { classifyTokenError } from '@consolevault/gsc';
import {
  authClientForAccount,
  discoverAccount,
  discoverExportConnection,
} from '@consolevault/store';
import type { Account, TokenHealth } from '@consolevault/types';
import { accountRepo, propertyRepo, secretStore, warehouse } from './deps.js';
import { HttpError } from './errors.js';

async function requireAccount(accountId: string): Promise<Account> {
  const account = await accountRepo.get(accountId);
  if (!account) throw new HttpError(404, 'Account not found');
  return account;
}

/**
 * Discover a connection's properties. For `bigquery_export` this reads the native Bulk Export
 * dataset (SPEC §12); otherwise it runs Sites:list and upserts the API-collected properties.
 */
export async function discoverForAccount(accountId: string): Promise<{ count: number }> {
  const account = await requireAccount(accountId); // 404 with the API's error shape if missing
  if (account.type === 'bigquery_export') {
    return discoverExportConnection(account, warehouse, accountRepo, propertyRepo);
  }
  return discoverAccount(accountId, secretStore, accountRepo, propertyRepo);
}

/**
 * Probe an account's credentials and persist its token health. Uses `authClientForAccount` so the
 * probe refreshes with the correct OAuth client (Desktop vs Web) — not a hardcoded one.
 */
export async function checkAccountHealth(accountId: string): Promise<TokenHealth> {
  const account = await requireAccount(accountId);
  let health: TokenHealth;
  try {
    const client = await authClientForAccount(account, secretStore);
    const token = await client.getAccessToken();
    health = token?.token ? 'valid' : 'broken';
  } catch (err) {
    health = classifyTokenError(err);
  }
  await accountRepo.setTokenHealth(accountId, health);
  return health;
}
