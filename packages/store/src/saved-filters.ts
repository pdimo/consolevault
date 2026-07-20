/**
 * Firestore repository for user-saved dashboard filter presets. A saved filter captures a set of
 * URL query params under a `scope` (`property:<id>` / `group:<id>` / `*`) so it can be reapplied
 * from the report toolbar. Purely a reporting-UX convenience — no collection/analytics impact.
 */

import type { Firestore } from '@google-cloud/firestore';
import type { SavedFilter } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';

export class SavedFilterRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.savedFilters);
  }

  /** Saved filters visible for a scope: that target plus the global `*` presets. */
  async listForScope(scope: string): Promise<SavedFilter[]> {
    const snap = await this.col().where('scope', 'in', [scope, '*']).get();
    return snap.docs
      .map((d) => d.data() as SavedFilter)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsert(filter: SavedFilter): Promise<void> {
    await this.col().doc(filter.id).set(filter);
  }

  async delete(id: string): Promise<void> {
    await this.col().doc(id).delete();
  }
}
