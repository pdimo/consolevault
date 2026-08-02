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
  | 'skipped' // (type × aggregation) not supported by the API — terminal, never collected
  | 'error';

/**
 * How a connection authenticates / sources data (SPEC §3, §12).
 * - `oauth` / `service_account` collect via the Search Analytics API.
 * - `bigquery_export` is not an auth method: it points at a Google-managed **native Bulk Export**
 *   BigQuery dataset. Its properties are read-only imports — ConsoleVault runs no collection for
 *   them (SPEC §12), it maps the export tables into the reporting layer via adapter views.
 */
export type AccountType = 'oauth' | 'service_account' | 'bigquery_export';

/**
 * Where a property's data comes from. `api` (default/undefined) = collected via the Search
 * Analytics API into ConsoleVault's own tables. `native_export` = read from a GSC native Bulk
 * Export dataset via adapter views; never collected (SPEC §12).
 */
export type PropertySource = 'api' | 'native_export';

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
  /**
   * For `bigquery_export` connections only: the GSC native Bulk Export dataset to read
   * (SPEC §12). `projectId` defaults to this deployment's project; `datasetId` defaults to
   * `searchconsole` (GSC's default export dataset name). `location` is the dataset's BigQuery
   * location, detected at connect — reports for a cross-region export run in that location.
   */
  exportDataset?: { projectId: string; datasetId: string; location?: string };
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
  /**
   * Data source (SPEC §12). Absent/`api` = collected via the Search Analytics API. `native_export`
   * = imported from a GSC native Bulk Export dataset via adapter views; never collected. The
   * reporting layer treats both identically (the adapter views expose the shared row schema).
   */
  source?: PropertySource;
  /**
   * For `native_export` properties: the BigQuery location of the source export dataset. When it
   * differs from the deployment's `bq_location`, the property's adapter views live in a region-local
   * dataset and its reports run in this location (BigQuery can't query across locations, SPEC §12).
   */
  exportLocation?: string;
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
  /** Denormalized collection status (stamped by the collector) for fast list rendering (Stage 7). */
  status?: PropertyStatus;
  /** Opt-in: surface an analytics dashboard for this property (Dashboards section). */
  dashboardEnabled?: boolean;
  /**
   * Brand terms for query classification (brand vs non-brand). A query is "brand" if it contains
   * any term (case-insensitive substring). Applied at QUERY time — never baked into collected rows —
   * so edits take effect instantly with no reprocessing. First instance of a general "segment".
   */
  brandTerms?: string[];
  /** Owning client (IA v2). Every tracked property belongs to exactly one client. */
  clientId?: string;
}

/** Lightweight, denormalized per-property collection status for the Properties list (Stage 7). */
export interface PropertyStatus {
  /** Most recent data_date collected WITH data. */
  lastCollectedDate?: string;
  /** Finality of that most-recent collected day. */
  dataState?: 'final' | 'fresh';
  /** When the collector last wrote data for this property (ISO 8601). */
  lastCollectedAt?: string;
  /** Most recent terminal error message + when it occurred (ISO 8601). */
  lastError?: string;
  lastErrorAt?: string;
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
  /** Opt-in: also maintain a materialized TABLE (group_<id>_mat) refreshed daily, for faster BI. */
  materialized?: boolean;
  /** Opt-in: surface an analytics dashboard for this group (Dashboards section). */
  dashboardEnabled?: boolean;
  /** Brand terms for query classification across the group (see Property.brandTerms). */
  brandTerms?: string[];
}

/**
 * A Client is a business that owns one or more properties (the top-level organizing unit — IA v2).
 * A client's report aggregates its properties (impression-weighted); a client with one property is
 * a single-property view. Properties point at their owning client via `Property.clientId`.
 */
export interface Client {
  id: string;
  name: string;
  /** Brand terms for the client's brand/non-brand segment (client-level default). */
  brandTerms?: string[];
  createdAt: string; // ISO 8601
}

/** Analytics dashboard target + filters (Dashboards feature). `client` aggregates its properties. */
export type DashboardTargetType = 'property' | 'group' | 'client';

export interface DashboardListItem {
  type: DashboardTargetType;
  id: string;
  name: string;
  /** Brand terms defined for this target (drives the brand/non-brand segment + split). */
  brandTerms?: string[];
  /** For `client`: how many properties it owns (UI count). */
  propertyCount?: number;
}

/** Shared filter/segmentation state for a dashboard (encoded in the URL). */
export interface DashboardFilters {
  searchType?: string; // default 'web'
  start: string; // YYYY-MM-DD (Pacific)
  end: string; // YYYY-MM-DD
  device?: string[];
  country?: string[];
  query?: string; // comma-separated "contains" terms
  page?: string; // comma-separated "contains" terms
  positionMin?: number;
  positionMax?: number;
  brandExclude?: string[]; // terms to exclude from query
  finalOnly?: boolean;
  /** Brand segment toggle. Applied with `brandTerms` (query-time classification). */
  segment?: 'brand' | 'nonbrand';
  /** Brand terms used to classify `segment` (and the brand split). */
  brandTerms?: string[];
  /**
   * Comparison-period mode for period-over-period deltas (KPIs, movers, trend overlay).
   * Defaults to 'previous' (the immediately-preceding same-length window) to preserve prior behaviour.
   */
  compareMode?: 'none' | 'previous' | 'yoy' | 'prev_month' | 'custom';
  /** Explicit comparison window (only when compareMode==='custom'). YYYY-MM-DD. */
  compareStart?: string;
  compareEnd?: string;
  /** YoY only: align to the same weekday by shifting 364 days instead of a calendar year. */
  matchWeekdays?: boolean;
  /** Named preset filters, OR-free (each AND-applied). 'paa' = question queries, 'longtail' = ≥4 words. */
  presets?: ('paa' | 'longtail')[];
}

/** One rule matching GSC rows on a dimension — `page` for content groups, `query` for topic clusters. */
export interface MatchRule {
  dimension: 'page' | 'query';
  op: 'contains' | 'starts_with' | 'equals' | 'regex';
  value: string;
}

/**
 * A per-property semantic grouping (Firestore `semantic_groups`). `content` groups pages by URL
 * rules; `topic` clusters group queries by keyword/regex rules. Rules within a group are OR'd — a
 * row belongs to the group if any rule matches. Deterministic and fully inspectable; an optional
 * AI-suggest step (Phase 2b) only proposes rules the user can edit.
 */
export interface SemanticGroup {
  id: string;
  propertyId: string;
  kind: 'content' | 'topic';
  name: string;
  /** Flags a priority group (★) for emphasis in the reports. */
  priority?: boolean;
  rules: MatchRule[];
  updatedAt?: string;
}

/** A user-saved filter preset for a dashboard target (Firestore `saved_filters`). */
export interface SavedFilter {
  id: string;
  /** Owning target: `${type}:${id}` (e.g. `property:abc`) or `*` for all targets. */
  scope: string;
  name: string;
  /** The filter state to apply, as URL query params (same shape the dashboard encodes). */
  params: Record<string, string>;
  createdAt: string;
}

/** Global defaults applied to newly-discovered properties (SPEC §10 settings). */
export interface Settings {
  defaultOffsetDays: number;
  defaultBackfillMonths: number;
  /** Default search types for new properties (web on by default). */
  defaultTypes: SearchType[];
  defaultAggregations: Aggregation[];
  /** Email for operational alerts (token health, errors, no-collection). Empty = alerting off. */
  alertEmail?: string;
  /**
   * Opt in to real Cloud Billing spend in the Costs panel. The dataset is always provisioned; turning
   * this on reveals the guided one-time Console export step + live status. Off = estimates only.
   */
  billingExportEnabled?: boolean;
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
