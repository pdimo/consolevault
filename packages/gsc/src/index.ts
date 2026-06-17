/**
 * Google Search Console API client wrapper (webmasters v3).
 *
 * Stage 0: STUB ONLY. This package intentionally makes NO API calls and collects NO data
 * (CLAUDE.md hard rule 3 — no search data before Stage 2). It declares the typed surface the
 * collector/discovery workers will use in Stage 1+ so downstream code can compile against it.
 */

import type { Aggregation, SearchType } from '@consolevault/types';

/** The single OAuth scope this product uses (SPEC §0). Read-only. */
export const WEBMASTERS_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Parameters for a Search Analytics query (shape only; not yet executed). */
export interface SearchAnalyticsQueryParams {
  siteUrl: string;
  /** ISO date `YYYY-MM-DD` (Pacific Time — CLAUDE.md hard rule 7). */
  startDate: string;
  endDate: string;
  searchType: SearchType;
  aggregation: Aggregation;
  startRow: number;
  rowLimit: number;
}

/**
 * Placeholder client. Construction is allowed, but any collection method throws until Stage 2.
 */
export class GscClient {
  /** Stage 1+. Lists properties visible to the authenticated account (Sites:list). */
  listSites(): never {
    throw new Error('GscClient.listSites is not implemented until Stage 1.');
  }

  /** Stage 2+. Runs a Search Analytics query. Not implemented at Stage 0. */
  query(_params: SearchAnalyticsQueryParams): never {
    throw new Error('GscClient.query is not implemented until Stage 2.');
  }
}
