/**
 * Short-TTL cache for `first_incomplete_date` (API efficiency, SPEC §8 / Stage 6). The value is
 * property/type-wide, but a daily run collects many recent days for the same (property, type) — each
 * task would otherwise re-probe. Caching it in Firestore for an hour collapses those probes to one
 * GSC API call per (siteUrl, searchType) per run, saving quota. A Firestore read is far cheaper than
 * a GSC query and doesn't count against the GSC quota.
 */

import { createHash } from 'node:crypto';
import { Firestore, type Timestamp } from '@google-cloud/firestore';
import { COLLECTIONS, getFirestore } from './firestore.js';

const TTL_MS = 60 * 60 * 1000; // 1 hour

interface ProbeDoc {
  firstIncompleteDate: string | null;
  expiresAt: Timestamp;
}

function docId(siteUrl: string, searchType: string): string {
  return createHash('sha256').update(`${siteUrl}|${searchType}`).digest('hex').slice(0, 40);
}

export class ProbeCache {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private ref(siteUrl: string, searchType: string) {
    return this.db.collection(COLLECTIONS.probeCache).doc(docId(siteUrl, searchType));
  }

  /**
   * Return the cached `first_incomplete_date` if still fresh; otherwise call `fetch`, cache it, and
   * return it. `{ probed: true }` signals an actual GSC API call was made (so the caller can count it).
   */
  async getOrFetch(
    siteUrl: string,
    searchType: string,
    fetch: () => Promise<string | null>,
  ): Promise<{ firstIncompleteDate: string | null; probed: boolean }> {
    const ref = this.ref(siteUrl, searchType);
    const snap = await ref.get();
    if (snap.exists) {
      const doc = snap.data() as ProbeDoc;
      if (doc.expiresAt.toMillis() > Date.now()) {
        return { firstIncompleteDate: doc.firstIncompleteDate ?? null, probed: false };
      }
    }
    const firstIncompleteDate = await fetch();
    await ref.set({
      firstIncompleteDate,
      expiresAt: new Date(Date.now() + TTL_MS),
    });
    return { firstIncompleteDate, probed: true };
  }
}
