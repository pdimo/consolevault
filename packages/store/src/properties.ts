/**
 * Firestore repository for `properties` (control plane) plus the pure discovery-merge logic.
 *
 * Properties are keyed by `sanitizeTableName(siteUrl)` so re-running discovery upserts the same
 * doc (no duplicates). A property reachable by several accounts is ONE doc whose `accountIds[]`
 * accumulates across discoverers (enables SPEC §3 failover later).
 */

import type { Firestore } from '@google-cloud/firestore';
import type {
  CollectionConfig,
  Property,
  PropertySource,
  PropertyStatus,
} from '@consolevault/types';
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

/**
 * Config for a native-export property (SPEC §12). Not collected, so offset/backfill are inert; both
 * aggregations are present because the export gives byProperty AND byPage, and all search types flow
 * through the adapter view (filtered at query time), so we don't gate types here.
 */
export const NATIVE_EXPORT_CONFIG: CollectionConfig = {
  types: ['web'],
  aggregations: ['byProperty', 'byPage'],
  offsetDays: 0,
  backfillMonths: 0,
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
  /** `native_export` for Bulk Export imports; omitted (→ `api`) for Sites:list discovery. */
  source?: PropertySource;
  /** BigQuery location of the source export dataset (native_export only). */
  exportLocation?: string;
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

/** Normalize a native Bulk Export `site_url` into a {@link DiscoveredProperty} (SPEC §12). */
export function discoveredFromExportSite(
  accountId: string,
  siteUrl: string,
  at: string,
  exportLocation?: string,
): DiscoveredProperty {
  const id = sanitizeTableName(siteUrl);
  return {
    id,
    siteUrl,
    propertyType: derivePropertyType(siteUrl),
    sanitizedTableName: id,
    accountId,
    at,
    source: 'native_export',
    ...(exportLocation !== undefined ? { exportLocation } : {}),
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
  const source = d.source ?? existing?.source;
  const isNative = source === 'native_export';
  const exportLocation = d.exportLocation ?? existing?.exportLocation;
  return {
    id: d.id,
    siteUrl: d.siteUrl,
    propertyType: d.propertyType,
    sanitizedTableName: d.sanitizedTableName,
    // Native-export properties are already present (no collection cost) → tracked by default.
    // API properties are opt-in per SPEC §7.1 (web-only, others off) → default excluded.
    included: existing?.included ?? isNative,
    accountIds,
    preferredAccountId: existing?.preferredAccountId ?? d.accountId,
    config: existing?.config ?? (isNative ? NATIVE_EXPORT_CONFIG : DEFAULT_COLLECTION_CONFIG),
    discoveredAt: existing?.discoveredAt ?? d.at,
    lastSeenAt: d.at,
    ...(source !== undefined ? { source } : {}),
    ...(exportLocation !== undefined ? { exportLocation } : {}),
    ...(permissionLevel !== undefined ? { permissionLevel } : {}),
    ...(groupIds !== undefined ? { groupIds } : {}),
  };
}

export class PropertyRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.properties);
  }

  /**
   * Upsert one discovery observation in a transaction; merges, never duplicates. Handles the
   * sanitized-name collision (distinct siteUrls that sanitize identically) by disambiguating with a
   * stable per-siteUrl hash. Shared by API (Sites:list) and native-export discovery.
   */
  private async upsertDiscovered(d: DiscoveredProperty): Promise<void> {
    await this.db.runTransaction(async (tx) => {
      let obs = d;
      let ref = this.col().doc(obs.id);
      let snap = await tx.get(ref);
      let existing = snap.exists ? (snap.data() as Property) : undefined;
      if (existing && existing.siteUrl !== obs.siteUrl) {
        const disId = disambiguatedTableName(obs.siteUrl);
        obs = { ...obs, id: disId, sanitizedTableName: disId };
        ref = this.col().doc(disId);
        snap = await tx.get(ref);
        existing = snap.exists ? (snap.data() as Property) : undefined;
      }
      tx.set(ref, mergeDiscoveredProperty(existing, obs));
    });
  }

  /** Upsert discovered sites for an account; merges, never duplicates. Returns the count seen. */
  async upsertFromDiscovery(accountId: string, sites: GscSite[], at: string): Promise<number> {
    for (const site of sites) {
      await this.upsertDiscovered(discoveredFromSite(accountId, site, at));
    }
    return sites.length;
  }

  /**
   * Upsert native Bulk Export site_urls for a `bigquery_export` connection (SPEC §12). Returns the
   * resolved (siteUrl → sanitizedTableName) so the caller can provision each property's adapter
   * views at the right table name (including any collision-disambiguated name).
   */
  async upsertNativeFromDiscovery(
    accountId: string,
    siteUrls: string[],
    at: string,
    exportLocation?: string,
  ): Promise<Array<{ siteUrl: string; sanitizedTableName: string }>> {
    const out: Array<{ siteUrl: string; sanitizedTableName: string }> = [];
    for (const siteUrl of siteUrls) {
      await this.upsertDiscovered(discoveredFromExportSite(accountId, siteUrl, at, exportLocation));
      const saved = await this.getBySiteUrl(siteUrl);
      out.push({
        siteUrl,
        sanitizedTableName: saved?.sanitizedTableName ?? sanitizeTableName(siteUrl),
      });
    }
    return out;
  }

  /** Find a property doc by its exact siteUrl (used after native upsert to read the resolved name). */
  async getBySiteUrl(siteUrl: string): Promise<Property | undefined> {
    const snap = await this.col().where('siteUrl', '==', siteUrl).limit(1).get();
    return snap.docs[0]?.data() as Property | undefined;
  }

  /**
   * Sanitized table names of native-export properties whose adapter views live in gsc_byProperty/
   * gsc_byPage — i.e. SAME-region as the deployment — to fold into the wildcard `_all` views.
   * Cross-region native properties live in a region-local dataset and can't join the `_all` union.
   */
  async listNativeExportTableNames(deployLocation: string): Promise<string[]> {
    const snap = await this.col().where('source', '==', 'native_export').get();
    return snap.docs
      .map((d) => d.data() as Property)
      .filter(
        (p) => !p.exportLocation || p.exportLocation.toUpperCase() === deployLocation.toUpperCase(),
      )
      .map((p) => p.sanitizedTableName);
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

  async setDashboardEnabled(id: string, enabled: boolean): Promise<void> {
    await this.col().doc(id).set({ dashboardEnabled: enabled }, { merge: true });
  }

  /** Brand terms for query classification (brand vs non-brand segment). */
  async setBrandTerms(id: string, brandTerms: string[]): Promise<void> {
    await this.col().doc(id).set({ brandTerms }, { merge: true });
  }

  /** Merge denormalized collection status onto a property doc (Stage 7 — fast list rendering). */
  async setStatus(id: string, status: Partial<PropertyStatus>): Promise<void> {
    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(status)) patch[`status.${k}`] = v;
    await this.col().doc(id).update(patch);
  }

  /** Every native-export property belonging to a connection (for cleanup on its removal). */
  async listNativeByAccount(accountId: string): Promise<Property[]> {
    const snap = await this.col().where('source', '==', 'native_export').get();
    return snap.docs
      .map((d) => d.data() as Property)
      .filter((p) => p.accountIds.includes(accountId));
  }

  /** Delete a property doc (native-export cleanup — API tables/coverage are managed elsewhere). */
  async delete(id: string): Promise<void> {
    await this.col().doc(id).delete();
  }
}
