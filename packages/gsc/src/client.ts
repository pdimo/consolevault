/**
 * Google Search Console API calls (webmasters v3): Sites:list (discovery) and Search Analytics.
 *
 * Stage 2 exercises only `web` + `byProperty`, but the query builder encodes per-type/aggregation
 * capability (SPEC §7, CLAUDE.md gotchas) so Stage 3's byPage/totals/discover slot in cleanly.
 */

import { webmasters } from '@googleapis/webmasters';
import type { AuthClient, OAuth2Client } from 'google-auth-library';
import type { Aggregation, DataState, GscRow, SearchType } from '@consolevault/types';
import { derivePropertyType } from './discovery.js';

/** A property as returned by Sites:list. */
export interface GscSite {
  siteUrl: string;
  permissionLevel?: string;
}

/** Search Analytics pagination limits (SPEC §5.2 / per-type gotchas). */
export const ROWS_PER_PAGE = 25000;
export const MAX_ROWS_PER_DAY = 50000;

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
 * Dimensions to request for a (type, aggregation) pair, encoding capability rules:
 * `discover` has no `query` dimension and no `byProperty`; `googleNews` has no `byProperty`.
 */
export function dimensionsFor(aggregation: Aggregation, searchType: SearchType): string[] {
  if (aggregation === 'totals') return [];
  if (aggregation === 'byProperty' && (searchType === 'discover' || searchType === 'googleNews')) {
    throw new Error(`${searchType} does not support byProperty aggregation`);
  }
  const base = aggregation === 'byPage' ? ['page', 'country', 'device'] : ['country', 'device'];
  // Discover has no query dimension.
  return searchType === 'discover' ? base : ['query', ...base];
}

interface SearchAnalyticsRequestBody {
  startDate: string;
  endDate: string;
  type: SearchType;
  dimensions: string[];
  aggregationType: 'byProperty' | 'byPage' | 'auto';
  rowLimit: number;
  startRow: number;
  dataState: DataState;
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
    dataState: 'final',
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

/** Execute ONE page of a Search Analytics query (the collector paginates via startRow). */
export async function querySearchAnalytics(
  authClient: AuthClient,
  params: SearchAnalyticsQueryParams,
): Promise<GscApiRow[]> {
  const api = webmasters({ version: 'v3', auth: asAuth(authClient) });
  const res = await api.searchanalytics.query({
    siteUrl: params.siteUrl,
    requestBody: buildQuery(params),
  });
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
      data_state: 'final',
    };
  });
}
