/**
 * Firestore repository for `accounts` (control plane).
 */

import type { Firestore } from '@google-cloud/firestore';
import type { Account, TokenHealth } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';

export class AccountRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.accounts);
  }

  async create(account: Account): Promise<void> {
    await this.col().doc(account.id).set(account);
  }

  async get(id: string): Promise<Account | undefined> {
    const doc = await this.col().doc(id).get();
    return doc.exists ? (doc.data() as Account) : undefined;
  }

  async list(): Promise<Account[]> {
    const snap = await this.col().get();
    return snap.docs.map((d) => d.data() as Account);
  }

  async update(id: string, patch: Partial<Account>): Promise<void> {
    await this.col().doc(id).set(patch, { merge: true });
  }

  async setTokenHealth(id: string, tokenHealth: TokenHealth): Promise<void> {
    await this.update(id, { tokenHealth });
  }

  async delete(id: string): Promise<void> {
    await this.col().doc(id).delete();
  }
}
