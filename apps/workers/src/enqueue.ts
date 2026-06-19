/**
 * Enqueue (SPEC §5.1, §5.3): turn pending Task docs into per-account, rate-limited Cloud Tasks
 * targeting the collector. Task name = taskId → duplicate names are rejected (free idempotency,
 * SPEC §9). One queue per account isolates each account's 1,200 QPM budget.
 */

import { CloudTasksClient } from '@google-cloud/tasks';
import { loadConfig } from '@consolevault/config';
import { DISPATCH_PER_SECOND_PER_ACCOUNT } from '@consolevault/gsc';
import { TaskRepository } from '@consolevault/store';
import type { Task } from '@consolevault/types';
import { TASK_MAX_ATTEMPTS } from './constants.js';

const config = loadConfig();
const tasksClient = new CloudTasksClient();

/** Dispatch rate per account queue (SPEC §5.3: well under the 1,200 QPM / 20 QPS user cap). */
const MAX_DISPATCHES_PER_SECOND = DISPATCH_PER_SECOND_PER_ACCOUNT;
const MAX_CONCURRENT_DISPATCHES = 10;

const RETRY_CONFIG = {
  maxAttempts: TASK_MAX_ATTEMPTS,
  minBackoff: { seconds: 10 },
  maxBackoff: { seconds: 3600 },
  maxDoublings: 6,
};

function queueId(accountId: string): string {
  return `cv-acct-${accountId}`.slice(0, 100);
}

function isAlreadyExists(err: unknown): boolean {
  return (err as { code?: number }).code === 6; // gRPC ALREADY_EXISTS
}

async function ensureQueue(accountId: string): Promise<string> {
  const parent = tasksClient.locationPath(config.projectId, config.region);
  const queuePath = tasksClient.queuePath(config.projectId, config.region, queueId(accountId));
  const desired = {
    name: queuePath,
    rateLimits: {
      maxDispatchesPerSecond: MAX_DISPATCHES_PER_SECOND,
      maxConcurrentDispatches: MAX_CONCURRENT_DISPATCHES,
    },
    retryConfig: RETRY_CONFIG,
  };
  try {
    const [queue] = await tasksClient.getQueue({ name: queuePath });
    // Reconcile the retry policy onto queues created before this config (or a changed maxAttempts).
    if (queue.retryConfig?.maxAttempts !== TASK_MAX_ATTEMPTS) {
      await tasksClient
        .updateQueue({ queue: desired, updateMask: { paths: ['retry_config'] } })
        .catch(() => {});
    }
  } catch {
    await tasksClient.createQueue({ parent, queue: desired }).catch((err: unknown) => {
      if (!isAlreadyExists(err)) throw err; // raced with another enqueue — fine
    });
  }
  return queuePath;
}

export async function enqueueAll(): Promise<{
  enqueued: number;
  deduped: number;
  accounts: number;
}> {
  const collectorUrl = process.env.COLLECTOR_URL;
  if (!collectorUrl) throw new Error('COLLECTOR_URL is required for enqueue.');
  const oidcServiceAccount = `sa-collector@${config.projectId}.iam.gserviceaccount.com`;

  const taskRepo = new TaskRepository();
  const pending = await taskRepo.listByStatus('pending');

  const byAccount = new Map<string, Task[]>();
  for (const t of pending) {
    if (!t.accountId) continue;
    let list = byAccount.get(t.accountId);
    if (!list) {
      list = [];
      byAccount.set(t.accountId, list);
    }
    list.push(t);
  }

  let enqueued = 0;
  let deduped = 0;
  for (const [accountId, tasks] of byAccount) {
    const queuePath = await ensureQueue(accountId);
    for (const t of tasks) {
      const body = Buffer.from(
        JSON.stringify({
          propertyId: t.propertyId,
          dataDate: t.dataDate,
          searchType: t.searchType,
          aggregation: t.aggregation,
        }),
      ).toString('base64');
      try {
        await tasksClient.createTask({
          parent: queuePath,
          task: {
            name: `${queuePath}/tasks/${t.id}`,
            httpRequest: {
              httpMethod: 'POST',
              url: `${collectorUrl}/collect`,
              headers: { 'Content-Type': 'application/json' },
              body,
              oidcToken: { serviceAccountEmail: oidcServiceAccount, audience: collectorUrl },
            },
          },
        });
        await taskRepo.markQueued(t.id);
        enqueued++;
      } catch (err) {
        if (isAlreadyExists(err)) {
          await taskRepo.markQueued(t.id);
          deduped++;
        } else {
          throw err;
        }
      }
    }
  }
  return { enqueued, deduped, accounts: byAccount.size };
}
