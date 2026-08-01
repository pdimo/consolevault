/**
 * Firestore repository for `tasks` (control-plane collection state) + the deterministic task id.
 *
 * The id doubles as the Cloud Tasks task name in Stage 3 (SPEC §9 idempotency), so it must be a
 * deterministic, name-safe string. Re-deriving the same id for the same cell dedups scheduling.
 */

import type { Firestore, QueryDocumentSnapshot } from '@google-cloud/firestore';
import type { Aggregation, SearchType, Task, TaskStatus } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';

/**
 * Terminal, locked statuses (SPEC §8): these are coverage history and are never re-collected, so
 * account-deletion cleanup preserves them (a re-added account keeps the same deterministic task
 * ids). Everything else (pending/queued/collected_fresh/error) is safe to purge.
 */
const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'collected_with_data',
  'collected_no_data',
  'skipped',
]);

/** Deterministic, Cloud-Tasks-name-safe id for one (property, type, agg, day) cell. */
export function taskId(
  propertyId: string,
  searchType: SearchType,
  aggregation: Aggregation,
  dataDate: string,
): string {
  return `${propertyId}__${searchType}__${aggregation}__${dataDate.replace(/-/g, '')}`;
}

export class TaskRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.tasks);
  }

  async create(task: Task): Promise<void> {
    await this.col().doc(task.id).set(task);
  }

  async get(id: string): Promise<Task | undefined> {
    const doc = await this.col().doc(id).get();
    return doc.exists ? (doc.data() as Task) : undefined;
  }

  /** Move a task to a terminal (or any) status, stamping terminalAt; merges extra fields. */
  async setTerminal(id: string, status: TaskStatus, patch: Partial<Task> = {}): Promise<void> {
    await this.col()
      .doc(id)
      .set({ status, terminalAt: new Date().toISOString(), ...patch }, { merge: true });
  }

  async list(): Promise<Task[]> {
    const snap = await this.col().get();
    return snap.docs.map((d) => d.data() as Task);
  }

  /** Tasks in a given status (single-field equality, auto-indexed). */
  async listByStatus(status: TaskStatus): Promise<Task[]> {
    const snap = await this.col().where('status', '==', status).get();
    return snap.docs.map((d) => d.data() as Task);
  }

  /** All tasks for a property (single-field equality, auto-indexed). */
  async listByProperty(propertyId: string): Promise<Task[]> {
    const snap = await this.col().where('propertyId', '==', propertyId).get();
    return snap.docs.map((d) => d.data() as Task);
  }

  /** Reset all terminal `error` tasks back to `pending` so the next run re-collects them. */
  async requeueErrors(): Promise<number> {
    const errors = await this.listByStatus('error');
    await Promise.all(
      errors.map((t) =>
        this.col().doc(t.id).set({ status: 'pending', attempts: 0 }, { merge: true }),
      ),
    );
    return errors.length;
  }

  /** Mark a task queued (set queuedAt). */
  async markQueued(id: string): Promise<void> {
    await this.col()
      .doc(id)
      .set({ status: 'queued', queuedAt: new Date().toISOString() }, { merge: true });
  }

  /**
   * Delete every non-terminal task belonging to an account (used when the account is removed) so no
   * orphaned pending/queued task keeps dispatching to a dead account, and no error task gets
   * requeued to it. Terminal locked tasks are preserved as coverage history (see
   * {@link TERMINAL_STATUSES}). Paged on the auto-indexed `accountId` field (no composite index
   * needed) and deleted with a BulkWriter so it scales past the 500-op batch limit. Returns the
   * count deleted.
   */
  async deleteNonTerminalByAccount(accountId: string): Promise<number> {
    const PAGE = 500;
    const writer = this.db.bulkWriter();
    let deleted = 0;
    let cursor: QueryDocumentSnapshot | undefined;
    for (;;) {
      let q = this.col().where('accountId', '==', accountId).orderBy('__name__').limit(PAGE);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) break;
      for (const doc of snap.docs) {
        if (!TERMINAL_STATUSES.has((doc.data() as Task).status)) {
          void writer.delete(doc.ref);
          deleted++;
        }
      }
      if (snap.size < PAGE) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    await writer.close();
    return deleted;
  }
}
