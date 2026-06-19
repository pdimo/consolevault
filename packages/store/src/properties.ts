/**
 * Firestore repository for `properties` (control plane) plus the pure discovery-merge logic.
 *
 * Properties are keyed by `sanitizeTableName(siteUrl)` so re-running discovery upserts the same
 * doc (no duplicates). A property reachable by several accounts is ONE doc whose `accountIds[]`
 * accumulates across discoverers (enables SPEC §3 failover later).
 */

import type { Firestore } from '@google-cloud/firestore';
import type { CollectionConfig, Property, PropertyStatus } from '@consolevault/types';
import { disambiguatedTableName, sanitizeTableName } from '@consolevault/bq';
import { derivePropertyType, type GscSite } from '@consolevault/gsc';
import { COLLECTIONS, getFirestore } from './firestore.js';

/** Default per-property collection config: web-only by default (SPEC §7.1, CLAUDE.md). */
export const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  types: ['web'],
  aggregations: ['byProperty'],
  offsetDays: 2,
  backfillMonths: 16,
};

/** A normalized discovery observation for one (account, site) at a point in time. */
export interface DiscoveredProperty {
  id: string;
  siteUrl: string;
  propertyType: Property['propertyType'];
  sanitizedTableName: string;
  permissionLevel?: string;
  accountId: string;
  at: string; // ISO 8601
}

/** Normalize a raw Sites:list entry into a {@link DiscoveredProperty}. */
export function discoveredFromSite(
  accountId: string,
  site: GscSite,
  at: string,
): DiscoveredProperty {
  const id = sanitizeTableName(site.siteUrl);
  return {
    id,
    siteUrl: site.siteUrl,
    propertyType: derivePropertyType(site.siteUrl),
    sanitizedTableName: id,
    accountId,
    at,
    ...(site.permissionLevel !== undefined ? { permissionLevel: site.permissionLevel } : {}),
  };
}

/**
 * Pure merge of a discovery observation into the existing property doc (if any). Accumulates
 * `accountIds`, preserves admin choices (`included`, `config`, `preferredAccountId`,
 * `discoveredAt`), and refreshes `lastSeenAt`/`permissionLevel`.
 */
export function mergeDiscoveredProperty(
  existing: Property | undefined,
  d: DiscoveredProperty,
): Property {
  const accountIds = existing
    ? Array.from(new Set([...existing.accountIds, d.accountId]))
    : [d.accountId];
  const permissionLevel = d.permissionLevel ?? existing?.permissionLevel;
  const groupIds = existing?.groupIds;
  return {
    id: d.id,
    siteUrl: d.siteUrl,
    propertyType: d.propertyType,
    sanitizedTableName: d.sanitizedTableName,
    included: existing?.included ?? false,
    accountIds,
    preferredAccountId: existing?.preferredAccountId ?? d.accountId,
    config: existing?.config ?? DEFAULT_COLLECTION_CONFIG,
    discoveredAt: existing?.discoveredAt ?? d.at,
    lastSeenAt: d.at,
    ...(permissionLevel !== undefined ? { permissionLevel } : {}),
    ...(groupIds !== undefined ? { groupIds } : {}),
  };
}

export class PropertyRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.properties);
  }

  /** Upsert discovered sites for an account; merges, never duplicates. Returns the count seen. */
  async upsertFromDiscovery(accountId: string, sites: GscSite[], at: string): Promise<number> {
    for (const site of sites) {
      await this.db.runTransaction(async (tx) => {
        let d = discoveredFromSite(accountId, site, at);
        let ref = this.col().doc(d.id);
        let snap = await tx.get(ref);
        let existing = snap.exists ? (snap.data() as Property) : undefined;
        // Collision: the base table name is already taken by a DIFFERENT siteUrl (e.g. paths that
        // sanitize identically, or IDN variants). Disambiguate with a stable per-siteUrl hash so the
        // two sites get distinct tables/docs instead of silently merging.
        if (existing && existing.siteUrl !== d.siteUrl) {
          const disId = disambiguatedTableName(site.siteUrl);
          d = { ...d, id: disId, sanitizedTableName: disId };
          ref = this.col().doc(disId);
          snap = await tx.get(ref);
          existing = snap.exists ? (snap.data() as Property) : undefined;
        }
        tx.set(ref, mergeDiscoveredProperty(existing, d));
      });
    }
    return sites.length;
  }

  async list(): Promise<Property[]> {
    const snap = await this.col().get();
    return snap.docs.map((d) => d.data() as Property);
  }

  async get(id: string): Promise<Property | undefined> {
    const doc = await this.col().doc(id).get();
    return doc.exists ? (doc.data() as Property) : undefined;
  }

  async setIncluded(id: string, included: boolean): Promise<void> {
    await this.col().doc(id).set({ included }, { merge: true });
  }

  async updateConfig(id: string, config: CollectionConfig): Promise<void> {
    await this.col().doc(id).set({ config }, { merge: true });
  }

  async setPreferredAccount(id: string, accountId: string): Promise<void> {
    await this.col().doc(id).set({ preferredAccountId: accountId }, { merge: true });
  }

  /** Merge denormalized collection status onto a property doc (Stage 7 — fast list rendering). */
  async setStatus(id: string, status: Partial<PropertyStatus>): Promise<void> {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(status)) patch[`status.${k}`] = v;
    await this.col().doc(id).update(patch);
  }
}
