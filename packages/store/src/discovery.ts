/**
 * Discovery orchestration (Sites:list → upsert properties), shared by the API's per-account
 * button (Stage 1) and the orchestrator's daily `/discover-all` (Stage 3). One path, one place.
 */

import { listSites } from '@consolevault/gsc';
import { DATASETS, type Warehouse } from '@consolevault/bq';
import type { Account } from '@consolevault/types';
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

/**
 * Discover a native Bulk Export connection (SPEC §12): list the distinct site_urls in the export
 * dataset, upsert them as `native_export` properties, (re)provision each property's adapter views,
 * and refresh the wildcard `_all` views to include them. No API collection.
 */
export async function discoverExportConnection(
  account: Account,
  warehouse: Warehouse,
  accountRepo: AccountRepository = new AccountRepository(),
  propertyRepo: PropertyRepository = new PropertyRepository(),
): Promise<{ count: number }> {
  if (account.type !== 'bigquery_export' || !account.exportDataset) {
    throw new Error(`Not a BigQuery-export connection: ${account.id}`);
  }
  const { projectId, datasetId } = account.exportDataset;
  // Detect the export's BigQuery location. BigQuery can't query across locations, so a cross-region
  // export's adapter views + reports run in ITS region (SPEC §12) — "query where the data lives".
  const location = (await warehouse.getDatasetLocation(projectId, datasetId)) ?? warehouse.location;
  // Persist the detected location on the connection (UI/Doctor + report execution use it).
  await accountRepo.update(account.id, { exportDataset: { projectId, datasetId, location } });

  const siteUrls = await warehouse.listExportSiteUrls(projectId, datasetId, location);
  const now = new Date().toISOString();
  const resolved = await propertyRepo.upsertNativeFromDiscovery(
    account.id,
    siteUrls,
    now,
    location,
  );
  for (const { siteUrl, sanitizedTableName } of resolved) {
    await warehouse.provisionNativeExportViews(
      sanitizedTableName,
      projectId,
      datasetId,
      siteUrl,
      location,
    );
  }
  // Only same-region native properties fold into the wildcard `_all` views (cross-region can't
  // join a single-region view). listNativeExportTableNames already filters to same-region.
  const nativeTables = await propertyRepo.listNativeExportTableNames(warehouse.location);
  await warehouse.refreshWildcardViews({
    [DATASETS.byProperty]: nativeTables,
    [DATASETS.byPage]: nativeTables,
  });
  await accountRepo.update(account.id, { lastSuccessAt: now, propertyCount: siteUrls.length });
  return { count: siteUrls.length };
}

/** Discover every account (used by the daily workflow's discover step). */
export async function discoverAllAccounts(
  secretStore: SecretStore,
  warehouse?: Warehouse,
): Promise<{ accounts: number; properties: number }> {
  const accountRepo = new AccountRepository();
  const propertyRepo = new PropertyRepository();
  const accounts = await accountRepo.list();
  let properties = 0;
  for (const account of accounts) {
    try {
      if (account.type === 'bigquery_export') {
        // Native-export connections are discovered from BigQuery, not the GSC API. Skip if no
        // warehouse was provided (e.g. a caller that only refreshes API accounts).
        if (!warehouse) continue;
        const { count } = await discoverExportConnection(
          account,
          warehouse,
          accountRepo,
          propertyRepo,
        );
        properties += count;
      } else {
        const { count } = await discoverAccount(account.id, secretStore, accountRepo, propertyRepo);
        properties += count;
      }
    } catch {
      // A broken account shouldn't abort discovery for the others; token-health surfaces it.
    }
  }
  return { accounts: accounts.length, properties };
}
