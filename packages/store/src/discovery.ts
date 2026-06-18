/**
 * Discovery orchestration (Sites:list → upsert properties), shared by the API's per-account
 * button (Stage 1) and the orchestrator's daily `/discover-all` (Stage 3). One path, one place.
 */

import { listSites } from '@consolevault/gsc';
import { AccountRepository } from './accounts.js';
import { PropertyRepository } from './properties.js';
import { SecretStore } from './secrets.js';
import { authClientForAccount } from './auth.js';

/** Run Sites:list for one account and upsert its discovered properties. */
export async function discoverAccount(
  accountId: string,
  secretStore: SecretStore,
  accountRepo: AccountRepository = new AccountRepository(),
  propertyRepo: PropertyRepository = new PropertyRepository(),
): Promise<{ count: number }> {
  const account = await accountRepo.get(accountId);
  if (!account) throw new Error(`Account not found: ${accountId}`);
  const authClient = await authClientForAccount(account, secretStore);
  const sites = await listSites(authClient);
  const now = new Date().toISOString();
  const count = await propertyRepo.upsertFromDiscovery(accountId, sites, now);
  await accountRepo.update(accountId, { lastSuccessAt: now });
  return { count };
}

/** Discover every account (used by the daily workflow's discover step). */
export async function discoverAllAccounts(
  secretStore: SecretStore,
): Promise<{ accounts: number; properties: number }> {
  const accountRepo = new AccountRepository();
  const propertyRepo = new PropertyRepository();
  const accounts = await accountRepo.list();
  let properties = 0;
  for (const account of accounts) {
    try {
      const { count } = await discoverAccount(account.id, secretStore, accountRepo, propertyRepo);
      properties += count;
    } catch {
      // A broken account shouldn't abort discovery for the others; token-health surfaces it.
    }
  }
  return { accounts: accounts.length, properties };
}
