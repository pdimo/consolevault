/**
 * ConsoleVault shared domain types — the single source of truth for domain models.
 * Import these everywhere; do not redefine domain shapes in apps/packages.
 *
 * Stage 0: defined but not yet consumed by runtime logic. Aligned to SPEC.md §2–§8.
 */

// ---------------------------------------------------------------------------
// Enums / string unions
// ---------------------------------------------------------------------------

/** GSC search types. `web` is collected by default; the rest are opt-in per property (SPEC §7.1). */
export type SearchType = 'web' | 'image' | 'video' | 'news' | 'discover' | 'googleNews';

/** Aggregation passes. They do NOT reconcile by design (SPEC §7.2). */
export type Aggregation = 'byProperty' | 'byPage' | 'totals';

/** GSC property kinds, modelled distinctly (SPEC §4). */
export type PropertyType = 'url_prefix' | 'domain';

/** OAuth token / credential health for an account (SPEC §3). */
export type TokenHealth = 'valid' | 'expires_soon' | 'broken' | 'revoked';

/**
 * Task states (SPEC §8). Terminal (locked) states are `collected_with_data` / `collected_no_data`
 * — reached only when the collected day is FINAL (`data_date < first_incomplete_date`).
 * `collected_fresh` is NON-terminal: the day was collected while still fresh (Google is still
 * finalizing it), so the planner re-collects it until it finalizes. `collected_no_data` is distinct
 * from `error` — the API omits days with no traffic rather than failing.
 */
export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'collected_fresh'
  | 'collected_with_data'
  | 'collected_no_data'
  | 'error';

/** How an account authenticates (SPEC §3). */
export type AccountType = 'oauth' | 'service_account';

/**
 * Per-row finality label stored in `GscRow.data_state`. `final` = Google has finalized the day
 * (`data_date < first_incomplete_date`); `fresh` = still being collected/processed and may change.
 */
export type DataState = 'final' | 'fresh';

// ---------------------------------------------------------------------------
// Control-plane entities (live in Firestore — SPEC §2)
// ---------------------------------------------------------------------------

/**
 * A Google account (OAuth login or service account) that can reach GSC properties.
 * `secretRef` is the Secret Manager resource name ONLY — never a raw token (CLAUDE.md hard rule 1).
 */
export interface Account {
  id: string;
  type: AccountType;
  displayName: string;
  /** Authorized Google account email (OAuth) or service-account email. */
  email?: string;
  /**
   * Secret Manager resource name, e.g. `projects/<p>/secrets/<id>`. Never a token.
   * Optional: a service account reached via impersonation has no stored secret.
   */
  secretRef?: string;
  /**
   * Secret Manager secret id of the OAuth client config that minted this account's refresh token
   * (refresh is client-specific). Defaults to the Desktop client (`oauth-client-config`); the
   * in-UI web flow sets `oauth-web-client-config`.
   */
  oauthClientSecretId?: string;
  tokenHealth: TokenHealth;
  createdAt: string; // ISO 8601
  lastSuccessAt?: string; // ISO 8601
  propertyCount?: number;
}

/** Per-property collection configuration (SPEC §7, §8). */
export interface CollectionConfig {
  /** Defaults to `['web']`; other types are opt-in per property. */
  types: SearchType[];
  aggregations: Aggregation[];
  /** Newest day attempted = today(PT) − offsetDays. Fresh days are auto-re-collected (SPEC §8). */
  offsetDays: number;
  /** How far back to backfill on first run. */
  backfillMonths: number;
}

/** A discovered GSC property (SPEC §4). */
export interface Property {
  id: string;
  /** `https://www.example.com/` or `sc-domain:example.com`. */
  siteUrl: string;
  propertyType: PropertyType;
  /** Sanitized, BigQuery-safe table name derived from the property (SPEC §6.1). */
  sanitizedTableName: string;
  /** Whether collection is enabled for this property. */
  included: boolean;
  /** Preferred account for collection; failover order in `accountIds` (SPEC §3). */
  preferredAccountId?: string;
  accountIds: string[];
  /** GSC permission level as reported by Sites:list (e.g. `siteOwner`). */
  permissionLevel?: string;
  config: CollectionConfig;
  groupIds?: string[];
  /** First time discovery saw this property (ISO 8601). */
  discoveredAt?: string;
  /** Most recent discovery run that still listed this property (ISO 8601). */
  lastSeenAt?: string;
}

/** An app-level property group (no native GSC grouping exists — SPEC §4, §6.4). */
export interface PropertyGroup {
  id: string;
  name: string;
  memberPropertyIds: string[];
  /** True when the group mixes a domain property with URL-prefix children (double-count risk). */
  doubleCountWarning?: boolean;
  /** Name of the generated BigQuery union view in gsc_views. */
  viewId?: string;
}

/** Global defaults applied to newly-discovered properties (SPEC §10 settings). */
export interface Settings {
  defaultOffsetDays: number;
  defaultBackfillMonths: number;
  /** Default search types for new properties (web on by default). */
  defaultTypes: SearchType[];
  defaultAggregations: Aggregation[];
}

/**
 * One unit of collection: property × searchType × aggregation × day (SPEC §8).
 * `id` is the task hash, reused as the Cloud Tasks task name for idempotency (SPEC §9).
 */
export interface Task {
  id: string;
  propertyId: string;
  searchType: SearchType;
  aggregation: Aggregation;
  /** ISO date `YYYY-MM-DD` in Pacific Time (SPEC §8, CLAUDE.md hard rule 7). */
  dataDate: string;
  status: TaskStatus;
  attempts: number;
  accountId?: string;
  queuedAt?: string; // ISO 8601
  terminalAt?: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// Analytics row (lives in BigQuery — SPEC §6.2)
// ---------------------------------------------------------------------------

/**
 * The nullable-shared GSC row shape — one shape across all types/aggregations so the
 * wildcard views stay trivial (SPEC §6.2). The BigQuery column/field schema that mirrors
 * this lives in `@consolevault/bq` (`schema.ts`).
 */
export interface GscRow {
  data_date: string; // DATE (YYYY-MM-DD, PT)
  property: string;
  property_type: PropertyType;
  search_type: SearchType;
  aggregation: Aggregation;
  /** Absent for `totals` and Discover. */
  query: string | null;
  /** Only present for `byPage`. */
  page: string | null;
  country: string | null;
  device: string | null;
  /** Discovered via the two-step query; never hard-code enums (SPEC §7.1). */
  search_appearance: string | null;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  is_anonymized: boolean;
  /** sha256 over the dimension tuple; dedup guard (SPEC §6.3). */
  row_hash: string;
  collected_at: string; // TIMESTAMP (ISO 8601)
  data_state: DataState;
}
