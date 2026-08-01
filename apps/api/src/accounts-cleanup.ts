/**
 * Cascade cleanup when an account is removed. Deleting an account must also remove everything it
 * owns — otherwise the refresh-token secret outlives the account (CLAUDE.md hard rule 1), the
 * per-account Cloud Tasks queue keeps dispatching to dead credentials, and orphaned pending tasks
 * get re-enqueued to it. The UI promises "its stored credentials are deleted"; this makes that true.
 *
 * Dependencies are injected so the sequencing/idempotency is unit-testable without live GCP.
 */

import type { CloudTasksClient } from '@google-cloud/tasks';
import { DATASETS, type Warehouse } from '@consolevault/bq';
import { accountQueueId, type AppConfig } from '@consolevault/config';
import {
  SECRET_IDS,
  type AccountRepository,
  type PropertyRepository,
  type SecretStore,
  type TaskRepository,
} from '@consolevault/store';
import type { Account } from '@consolevault/types';

export interface AccountCleanupDeps {
  accountRepo: Pick<AccountRepository, 'delete' | 'get'>;
  taskRepo: Pick<TaskRepository, 'deleteNonTerminalByAccount'>;
  secretStore: Pick<SecretStore, 'deleteSecret'>;
  tasksClient: Pick<CloudTasksClient, 'deleteQueue' | 'queuePath'>;
  propertyRepo: Pick<
    PropertyRepository,
    'listNativeByAccount' | 'delete' | 'listNativeExportTableNames'
  >;
  warehouse: Pick<Warehouse, 'dropNativeExportViews' | 'refreshWildcardViews'>;
  config: Pick<AppConfig, 'projectId' | 'region'>;
}

export interface AccountCleanupSummary {
  tasksDeleted: number;
  queueDeleted: boolean;
  secretsDeleted: number;
  propertiesDeleted: number;
}

/**
 * Delete an account and everything it owns. Order matters: the account doc is deleted LAST so that
 * a failure partway through leaves the account visible in the UI and the whole operation safe to
 * retry (every step is idempotent). Queue and secret removals tolerate NOT_FOUND.
 */
export async function deleteAccountCascade(
  id: string,
  deps: AccountCleanupDeps,
): Promise<AccountCleanupSummary> {
  const account: Account | undefined = await deps.accountRepo.get(id);

  // 1. Purge non-terminal tasks first — stop anything from re-dispatching to the account.
  const tasksDeleted = await deps.taskRepo.deleteNonTerminalByAccount(id);

  // 2. Delete the per-account Cloud Tasks queue (idempotent — NOT_FOUND is fine).
  const queuePath = deps.tasksClient.queuePath(
    deps.config.projectId,
    deps.config.region,
    accountQueueId(id),
  );
  let queueDeleted = false;
  try {
    await deps.tasksClient.deleteQueue({ name: queuePath });
    queueDeleted = true;
  } catch (err) {
    if ((err as { code?: number }).code !== 5) throw err; // gRPC NOT_FOUND — already gone
  }

  // 3. Destroy stored credentials — both possible secret ids for the account (idempotent).
  let secretsDeleted = 0;
  for (const secretId of [SECRET_IDS.oauthRefresh(id), SECRET_IDS.saKey(id)]) {
    if (await deps.secretStore.deleteSecret(secretId)) secretsDeleted++;
  }

  // 4. Native-export connections (SPEC §12): drop each imported property's adapter views and its
  // doc, then rebuild the wildcard `_all` views without them. (No secrets/queue/tasks for these.)
  let propertiesDeleted = 0;
  if (account?.type === 'bigquery_export') {
    const properties = await deps.propertyRepo.listNativeByAccount(id);
    for (const p of properties) {
      await deps.warehouse.dropNativeExportViews(p.sanitizedTableName);
      await deps.propertyRepo.delete(p.id);
      propertiesDeleted++;
    }
    if (propertiesDeleted > 0) {
      const nativeTables = await deps.propertyRepo.listNativeExportTableNames();
      await deps.warehouse.refreshWildcardViews({
        [DATASETS.byProperty]: nativeTables,
        [DATASETS.byPage]: nativeTables,
      });
    }
  }

  // 5. Finally remove the account doc.
  await deps.accountRepo.delete(id);

  return { tasksDeleted, queueDeleted, secretsDeleted, propertiesDeleted };
}
