/**
 * Google Search Console API calls (webmasters v3): Sites:list (discovery) and Search Analytics.
 *
 * Stage 2 exercises only `web` + `byProperty`, but the query builder encodes per-type/aggregation
 * capability (SPEC §7, CLAUDE.md gotchas) so Stage 3's byPage/totals/discover slot in cleanly.
 */

import { webmasters } from '@googleapis/webmasters';
import type { AuthClient, OAuth2Client } from 'google-auth-library';
import type { Aggregation, GscRow, SearchType } from '@consolevault/types';
import { derivePropertyType } from './discovery.js';
import { addDays } from './dates.js';

/** A property as returned by Sites:list. */
export interface GscSite {
  siteUrl: string;
  permissionLevel?: string;
}

/** Search Analytics pagination limits (SPEC §5.2 / per-type gotchas). */
export const ROWS_PER_PAGE = 25000;
export const MAX_ROWS_PER_DAY = 50000;

// API efficiency (https://developers.google.com/webmaster-tools/v1/how-tos/performance):
// a "(gzip)" User-Agent requests gzip (gaxios decompresses transparently), and the `fields`
// partial-response mask trims the payload to only what we consume. We deliberately do NOT batch —
// batched calls count as N queries against quota (no benefit) and would concentrate load.
const REQUEST_OPTS = { headers: { 'User-Agent': 'ConsoleVault (gzip)' } } as const;
/** Data queries: we only read keys + the four metrics. */
const DATA_FIELDS = 'rows(keys,clicks,impressions,ctr,position)';
/** Probe: we only read metadata.first_incomplete_date — drop the rows entirely. */
const METADATA_FIELDS = 'metadata';

function asAuth(authClient: AuthClient): OAuth2Client {
  // webmasters' `auth` option type lists only OAuth2Client/GoogleAuth/external, but every
  // AuthClient we pass (OAuth2Client, Impersonated, JWT) implements `.request()` at runtime.
  return authClient as OAuth2Client;
}

/** List every property visible to the authenticated account (Sites:list). */
export async function listSites(authClient: AuthClient): Promise<GscSite[]> {
  const api = webmasters({ version: 'v3', auth: asAuth(authClient) });
  const res = await api.sites.list({});
  const entries = res.data.siteEntry ?? [];
  return entries
    .filter((e): e is { siteUrl: string; permissionLevel?: string } => Boolean(e.siteUrl))
    .map((e) => ({
      siteUrl: e.siteUrl,
      ...(e.permissionLevel ? { permissionLevel: e.permissionLevel } : {}),
    }));
}

export interface SearchAnalyticsQueryParams {
  siteUrl: string;
  /** ISO date `YYYY-MM-DD` (Pacific Time — CLAUDE.md hard rule 7). Single day: start == end. */
  startDate: string;
  endDate: string;
  searchType: SearchType;
  aggregation: Aggregation;
  startRow: number;
  rowLimit: number;
}

/**
 * Whether a (searchType, aggregation) pair is collectable (pure; unit-tested). `discover` and
 * `googleNews` don't support `byProperty`; since `totals` is computed as a byProperty rollup
 * (SPEC §7.2), it's invalid for those types too. Everything else (web/image/video/news × any agg,
 * discover/googleNews × byPage) is valid.
 */
export function isValidCombo(searchType: SearchType, aggregation: Aggregation): boolean {
  const noByProperty = searchType === 'discover' || searchType === 'googleNews';
  if (noByProperty && (aggregation === 'byProperty' || aggregation === 'totals')) return false;
  return true;
}

/**
 * Dimensions each searchType actually supports (besides the implicit date range). Discover and
 * Google News are page/country only — they reject `query` AND `device` (confirmed live:
 * "Requests for Discover cannot be grouped by device") — and don't support `byProperty`.
 */
const TYPE_DIMENSIONS: Record<SearchType, ReadonlySet<string>> = {
  web: new Set(['query', 'page', 'country', 'device']),
  image: new Set(['query', 'page', 'country', 'device']),
  video: new Set(['query', 'page', 'country', 'device']),
  news: new Set(['query', 'page', 'country', 'device']),
  discover: new Set(['page', 'country']),
  googleNews: new Set(['page', 'country']),
};

/**
 * Dimensions to request for a (type, aggregation) pair: the aggregation's wanted dimensions
 * intersected with what the searchType supports (so we never send an invalid dimension).
 */
export function dimensionsFor(aggregation: Aggregation, searchType: SearchType): string[] {
  if (aggregation === 'totals') return [];
  if (!isValidCombo(searchType, aggregation)) {
    throw new Error(`${searchType} does not support ${aggregation} aggregation`);
  }
  const wanted =
    aggregation === 'byPage'
      ? ['query', 'page', 'country', 'device']
      : ['query', 'country', 'device'];
  return wanted.filter((d) => TYPE_DIMENSIONS[searchType].has(d));
}

interface SearchAnalyticsRequestBody {
  startDate: string;
  endDate: string;
  type: SearchType;
  dimensions: string[];
  aggregationType: 'byProperty' | 'byPage' | 'auto';
  rowLimit: number;
  startRow: number;
  /** Request `all` so the response includes fresh data + `metadata.first_incomplete_date`. */
  dataState: 'all' | 'final';
}

/** Build the Search Analytics request body (pure; unit-tested). */
export function buildQuery(params: SearchAnalyticsQueryParams): SearchAnalyticsRequestBody {
  return {
    startDate: params.startDate,
    endDate: params.endDate,
    type: params.searchType,
    dimensions: dimensionsFor(params.aggregation, params.searchType),
    aggregationType: params.aggregation === 'totals' ? 'byProperty' : params.aggregation,
    rowLimit: params.rowLimit,
    startRow: params.startRow,
    dataState: 'all',
  };
}

/** One raw page of Search Analytics results (nullable to match the webmasters API types). */
export interface GscApiRow {
  keys?: string[] | null;
  clicks?: number | null;
  impressions?: number | null;
  ctr?: number | null;
  position?: number | null;
}

/**
 * A day is final when there's no incomplete boundary, or the day precedes it (SPEC §8). Pure.
 */
export function isDayFinal(dataDate: string, firstIncompleteDate: string | null): boolean {
  return !firstIncompleteDate || dataDate < firstIncompleteDate;
}

/** How far back a range probe spans to capture `first_incomplete_date` (which sits near today). */
const PROBE_RANGE_DAYS = 16;

/**
 * Fetch the property's `metadata.first_incomplete_date` (Pacific Time). The API only returns
 * `metadata` for a MULTI-day range, so this issues one cheap `[date]`-grouped range query over the
 * last ~16 days. The value is property/type-wide, so the collector probes it once per recent day.
 * Returns null if the API omits it (older endpoints / no incomplete data).
 */
export async function fetchFirstIncompleteDate(
  authClient: AuthClient,
  siteUrl: string,
  searchType: SearchType,
  todayPt: string,
): Promise<string | null> {
  const api = webmasters({ version: 'v3', auth: asAuth(authClient) });
  const requestBody: SearchAnalyticsRequestBody = {
    startDate: addDays(todayPt, -PROBE_RANGE_DAYS),
    endDate: todayPt,
    type: searchType,
    dimensions: ['date'],
    aggregationType: 'auto',
    rowLimit: 1, // we only need metadata, not the rows
    startRow: 0,
    dataState: 'all',
  };
  const res = await api.searchanalytics.query(
    { siteUrl, requestBody, fields: METADATA_FIELDS },
    REQUEST_OPTS,
  );
  const meta = (
    res.data as { metadata?: { firstIncompleteDate?: string; first_incomplete_date?: string } }
  ).metadata;
  return meta?.firstIncompleteDate ?? meta?.first_incomplete_date ?? null;
}

/** Execute ONE page of a Search Analytics query (the collector paginates via startRow). */
export async function querySearchAnalytics(
  authClient: AuthClient,
  params: SearchAnalyticsQueryParams,
): Promise<GscApiRow[]> {
  const api = webmasters({ version: 'v3', auth: asAuth(authClient) });
  const res = await api.searchanalytics.query(
    { siteUrl: params.siteUrl, requestBody: buildQuery(params), fields: DATA_FIELDS },
    REQUEST_OPTS,
  );
  return res.data.rows ?? [];
}

/**
 * Map raw API rows to the shared row shape WITHOUT `row_hash` (the collector applies
 * `@consolevault/bq` `rowHash` so the hash stays the single source for the dedup check).
 */
export function mapRowsToGscRows(
  rows: GscApiRow[],
  params: SearchAnalyticsQueryParams,
  collectedAt: string,
  isFinal: boolean,
): Omit<GscRow, 'row_hash'>[] {
  const dims = dimensionsFor(params.aggregation, params.searchType);
  const valueOf = (keys: string[], dim: string): string | null => {
    const i = dims.indexOf(dim);
    return i >= 0 ? (keys[i] ?? null) : null;
  };
  return rows.map((r) => {
    const keys = r.keys ?? [];
    return {
      data_date: params.startDate,
      property: params.siteUrl,
      property_type: derivePropertyType(params.siteUrl),
      search_type: params.searchType,
      aggregation: params.aggregation,
      query: valueOf(keys, 'query'),
      page: valueOf(keys, 'page'),
      country: valueOf(keys, 'country'),
      device: valueOf(keys, 'device'),
      search_appearance: null,
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
      is_anonymized: false,
      collected_at: collectedAt,
      data_state: isFinal ? 'final' : 'fresh',
    };
  });
}
