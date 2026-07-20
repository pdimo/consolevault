/**
 * Deterministic auto-grouping — turns a property's own pages/queries into sensible Content Groups and
 * Topic Clusters with zero configuration. Fully inspectable and universal (no AI, no per-site tuning),
 * so it is "logically correct and applies to any use case". The user can still self-define/edit; these
 * are the automatic default the reports fall back to when nothing is saved.
 */

import type { MatchRule } from '@consolevault/types';

export interface AutoGroup {
  name: string;
  rules: MatchRule[];
}

/** Common English + generic web stopwords excluded from topic-cluster head terms. */
const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'of',
  'to',
  'in',
  'on',
  'at',
  'by',
  'with',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'as',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'you',
  'my',
  'your',
  'we',
  'our',
  'do',
  'does',
  'did',
  'can',
  'how',
  'what',
  'when',
  'where',
  'why',
  'which',
  'who',
  'near',
  'me',
  'vs',
  'best',
  'top',
  'new',
  'get',
  'buy',
  'cheap',
  'free',
]);

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** The URL path (leading slash) of a full GSC page URL, host-agnostic. */
function pathOf(page: string): string {
  const m = page.match(/^https?:\/\/[^/]+(\/.*)?$/i);
  if (m) return m[1] ?? '/';
  return page.startsWith('/') ? page : `/${page}`;
}

/** First path segment — '' for the site root (homepage). */
function firstSegment(page: string): string {
  return pathOf(page).split('/').filter(Boolean)[0] ?? '';
}

/**
 * Content groups from the first URL path segment (e.g. /blog/…, /products/…). Root pages become
 * "Homepage". Rules are host-agnostic (`page contains "/seg/"`), so they work for any property.
 */
export function autoContentGroups(
  pages: { page: string; impressions: number }[],
  limit = 12,
): AutoGroup[] {
  const bySeg = new Map<string, number>();
  for (const p of pages) {
    if (!p.page) continue;
    const seg = firstSegment(p.page);
    bySeg.set(seg, (bySeg.get(seg) ?? 0) + Math.max(0, p.impressions || 0));
  }
  return [...bySeg.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([seg]) =>
      seg === ''
        ? {
            name: 'Homepage',
            rules: [{ dimension: 'page', op: 'regex', value: '^https?://[^/]+/?$' }],
          }
        : {
            name: titleCase(seg),
            rules: [{ dimension: 'page', op: 'contains', value: `/${seg}/` }],
          },
    );
}

function tokenize(query: string, brand: Set<string>): string[] {
  return (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t) && !brand.has(t) && !/^\d+$/.test(t),
  );
}

/**
 * Topic clusters via greedy head-term set-cover: repeatedly pick the highest impression-weighted term
 * across the still-unclustered queries and claim every query containing it. Each query lands in exactly
 * one cluster; ties break alphabetically for stable, reproducible output. Rule = `query contains term`.
 */
export function autoTopicClusters(
  queries: { query: string; impressions: number }[],
  opts: { brandTerms?: string[] } = {},
  limit = 12,
): AutoGroup[] {
  const brand = new Set((opts.brandTerms ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean));
  const docs = queries
    .filter((q) => q.query)
    .map((q) => ({ impr: Math.max(0, q.impressions || 0), terms: tokenize(q.query, brand) }));
  const remaining = new Set(docs.map((_, i) => i).filter((i) => docs[i]!.terms.length > 0));
  const clusters: AutoGroup[] = [];
  while (clusters.length < limit && remaining.size) {
    const df = new Map<string, number>();
    for (const i of remaining) {
      for (const t of new Set(docs[i]!.terms)) df.set(t, (df.get(t) ?? 0) + docs[i]!.impr + 1);
    }
    let best: string | undefined;
    let bestScore = -1;
    for (const [t, score] of df) {
      if (score > bestScore || (score === bestScore && best !== undefined && t < best)) {
        best = t;
        bestScore = score;
      }
    }
    if (best === undefined) break;
    const members = [...remaining].filter((i) => docs[i]!.terms.includes(best!));
    if (!members.length) break;
    for (const i of members) remaining.delete(i);
    clusters.push({ name: best, rules: [{ dimension: 'query', op: 'contains', value: best }] });
  }
  return clusters;
}
