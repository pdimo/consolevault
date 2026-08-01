import { describe, expect, it, vi } from 'vitest';
import { deleteAccountCascade, type AccountCleanupDeps } from './accounts-cleanup.js';

const config = { projectId: 'proj', region: 'us-central1' };

/** A deps set with spies, letting each test override behaviour and assert call order. */
function makeDeps(overrides: Partial<AccountCleanupDeps> = {}): {
  deps: AccountCleanupDeps;
  order: string[];
} {
  const order: string[] = [];
  const deps: AccountCleanupDeps = {
    accountRepo: {
      get: vi.fn(async () => ({ id: 'acct', type: 'oauth' }) as never),
      delete: vi.fn(async () => {
        order.push('account');
      }),
    },
    propertyRepo: {
      listNativeByAccount: vi.fn(async () => []),
      listNativeExportTableNames: vi.fn(async () => []),
      delete: vi.fn(async () => {}),
    },
    warehouse: {
      dropNativeExportViews: vi.fn(async () => {}),
      refreshWildcardViews: vi.fn(async () => []),
    },
    taskRepo: {
      deleteNonTerminalByAccount: vi.fn(async () => {
        order.push('tasks');
        return 3;
      }),
    },
    tasksClient: {
      queuePath: vi.fn(
        (p: string, r: string, q: string) => `projects/${p}/locations/${r}/queues/${q}`,
      ),
      deleteQueue: vi.fn(async () => {
        order.push('queue');
        return [{}] as never;
      }),
    },
    secretStore: {
      deleteSecret: vi.fn(async () => {
        order.push('secret');
        return true;
      }),
    },
    config,
    ...overrides,
  };
  return { deps, order };
}

describe('deleteAccountCascade', () => {
  it('deletes tasks, queue, and both secrets before the account doc, in that order', async () => {
    const { deps, order } = makeDeps();

    const summary = await deleteAccountCascade('acct-1', deps);

    // Account doc is removed LAST so a mid-failure leaves it visible + retryable.
    expect(order).toEqual(['tasks', 'queue', 'secret', 'secret', 'account']);
    expect(summary).toEqual({
      tasksDeleted: 3,
      queueDeleted: true,
      secretsDeleted: 2,
      propertiesDeleted: 0,
    });
    expect(deps.secretStore.deleteSecret).toHaveBeenCalledWith('oauth-refresh-acct-1');
    expect(deps.secretStore.deleteSecret).toHaveBeenCalledWith('sa-key-acct-1');
    expect(deps.tasksClient.deleteQueue).toHaveBeenCalledWith({
      name: 'projects/proj/locations/us-central1/queues/cv-acct-acct-1',
    });
  });

  it('treats a missing queue (NOT_FOUND) as already gone and still deletes the account', async () => {
    const { deps } = makeDeps({
      tasksClient: {
        queuePath: vi.fn(() => 'q'),
        deleteQueue: vi.fn(async () => {
          throw { code: 5 }; // gRPC NOT_FOUND
        }),
      },
    });

    const summary = await deleteAccountCascade('acct-2', deps);

    expect(summary.queueDeleted).toBe(false);
    expect(deps.accountRepo.delete).toHaveBeenCalledWith('acct-2');
  });

  it('counts only secrets that actually existed', async () => {
    let call = 0;
    const { deps } = makeDeps({
      secretStore: {
        deleteSecret: vi.fn(async () => {
          call += 1;
          return call === 1; // first secret existed, second did not
        }),
      },
    });

    const summary = await deleteAccountCascade('acct-3', deps);

    expect(summary.secretsDeleted).toBe(1);
  });

  it('drops adapter views and property docs for a native-export connection', async () => {
    const { deps } = makeDeps({
      accountRepo: {
        get: vi.fn(async () => ({ id: 'exp', type: 'bigquery_export' }) as never),
        delete: vi.fn(async () => {}),
      },
      propertyRepo: {
        listNativeByAccount: vi.fn(async () => [
          { id: 'p1', sanitizedTableName: 'urlp_a' },
          { id: 'p2', sanitizedTableName: 'domain_b' },
        ]) as never,
        listNativeExportTableNames: vi.fn(async () => []),
        delete: vi.fn(async () => {}),
      },
    });

    const summary = await deleteAccountCascade('exp', deps);

    expect(summary.propertiesDeleted).toBe(2);
    expect(deps.warehouse.dropNativeExportViews).toHaveBeenCalledWith('urlp_a');
    expect(deps.warehouse.dropNativeExportViews).toHaveBeenCalledWith('domain_b');
    expect(deps.propertyRepo.delete).toHaveBeenCalledTimes(2);
    expect(deps.warehouse.refreshWildcardViews).toHaveBeenCalledTimes(1);
    expect(deps.accountRepo.delete).toHaveBeenCalledWith('exp');
  });

  it('propagates a non-NOT_FOUND queue error and does NOT delete the account', async () => {
    const { deps } = makeDeps({
      tasksClient: {
        queuePath: vi.fn(() => 'q'),
        deleteQueue: vi.fn(async () => {
          throw { code: 7 }; // gRPC PERMISSION_DENIED
        }),
      },
    });

    await expect(deleteAccountCascade('acct-4', deps)).rejects.toMatchObject({ code: 7 });
    expect(deps.accountRepo.delete).not.toHaveBeenCalled();
  });
});
