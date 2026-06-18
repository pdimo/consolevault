/** Firestore repository for app-level property groups (SPEC §4, §6.4). */

import type { Firestore } from '@google-cloud/firestore';
import type { PropertyGroup } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';

export class GroupRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.groups);
  }

  async list(): Promise<PropertyGroup[]> {
    const snap = await this.col().get();
    return snap.docs.map((d) => d.data() as PropertyGroup);
  }

  async get(id: string): Promise<PropertyGroup | undefined> {
    const doc = await this.col().doc(id).get();
    return doc.exists ? (doc.data() as PropertyGroup) : undefined;
  }

  async upsert(group: PropertyGroup): Promise<void> {
    await this.col().doc(group.id).set(group);
  }

  async delete(id: string): Promise<void> {
    await this.col().doc(id).delete();
  }
}
