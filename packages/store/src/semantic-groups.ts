/**
 * Firestore repository for per-property semantic groups — content groups (page rules) and topic
 * clusters (query rules). Docs are keyed `${propertyId}__${id}` so a property's groups list with a
 * single-field query. These drive report grouping (Phase 2b); no collection/analytics impact here.
 */

import type { Firestore } from '@google-cloud/firestore';
import type { SemanticGroup } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';

export class SemanticGroupRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.semanticGroups);
  }

  private docId(g: Pick<SemanticGroup, 'propertyId' | 'id'>) {
    return `${g.propertyId}__${g.id}`;
  }

  /** All groups for a property, optionally filtered to one kind. */
  async listForProperty(
    propertyId: string,
    kind?: SemanticGroup['kind'],
  ): Promise<SemanticGroup[]> {
    const snap = await this.col().where('propertyId', '==', propertyId).get();
    const groups = snap.docs.map((d) => d.data() as SemanticGroup);
    return (kind ? groups.filter((g) => g.kind === kind) : groups).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  async upsert(group: SemanticGroup): Promise<void> {
    await this.col().doc(this.docId(group)).set(group);
  }

  async delete(propertyId: string, id: string): Promise<void> {
    await this.col().doc(this.docId({ propertyId, id })).delete();
  }
}
