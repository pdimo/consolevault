/**
 * Firestore-backed result cache for dashboard reports (the "Morning Paper" pattern). The default
 * (unfiltered) views are warmed daily by the orchestrator; any view is cached on first request.
 * A cache hit serves instantly at $0 BigQuery cost. Keyed by a hash of (target, report, filters).
 */

import { createHash } from 'node:crypto';
import { Firestore, type Timestamp } from '@google-cloud/firestore';
import { COLLECTIONS, getFirestore } from './firestore.js';

interface CacheDoc<T> {
  data: T;
  expiresAt: Timestamp;
}

export function cacheKey(type: string, id: string, report: string, qs: string): string {
  return createHash('sha256').update(`${type}|${id}|${report}|${qs}`).digest('hex').slice(0, 48);
}

/** Canonical (sorted) query string so the same filters hash identically regardless of order. */
export function canonicalQs(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const k of Object.keys(q).sort()) {
    const v = q[k];
    if (v != null && v !== '') p.set(k, String(v));
  }
  return p.toString();
}

export class DashboardCache {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private ref(key: string) {
    return this.db.collection(COLLECTIONS.dashboardCache).doc(key);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const snap = await this.ref(key).get();
    if (!snap.exists) return undefined;
    const doc = snap.data() as CacheDoc<T>;
    return doc.expiresAt.toMillis() > Date.now() ? doc.data : undefined;
  }

  async set<T>(key: string, data: T, ttlMs: number): Promise<void> {
    await this.ref(key).set({ data, expiresAt: new Date(Date.now() + ttlMs) });
  }

  /** Cache-aside: return the cached value or compute + store it. */
  async wrap<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const data = await fn();
    await this.set(key, data, ttlMs).catch(() => {});
    return data;
  }
}
