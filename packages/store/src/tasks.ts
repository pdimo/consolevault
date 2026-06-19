/**
 * Firestore repository for `tasks` (control-plane collection state) + the deterministic task id.
 *
 * The id doubles as the Cloud Tasks task name in Stage 3 (SPEC §9 idempotency), so it must be a
 * deterministic, name-safe string. Re-deriving the same id for the same cell dedups scheduling.
 */

import type { Firestore } from '@google-cloud/firestore';
import type { Aggregation, SearchType, Task, TaskStatus } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';

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
}
