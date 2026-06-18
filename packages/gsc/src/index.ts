/**
 * `@consolevault/gsc` — Google Search Console API wrapper (webmasters v3).
 *
 * Stage 1: real auth + Sites:list discovery. Search Analytics collection is NOT implemented
 * (CLAUDE.md hard rule 3 — no search data before Stage 2).
 */

export * from './auth.js';
export * from './client.js';
export * from './dates.js';
export * from './discovery.js';
export * from './errors.js';
