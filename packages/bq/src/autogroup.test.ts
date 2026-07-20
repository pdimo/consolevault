import { describe, expect, it } from 'vitest';
import { autoContentGroups, autoTopicClusters } from './autogroup.js';

describe('autoContentGroups', () => {
  it('groups by first URL path segment, host-agnostic, ranked by impressions', () => {
    const groups = autoContentGroups([
      { page: 'https://www.x.com/blog/a', impressions: 100 },
      { page: 'https://www.x.com/blog/b', impressions: 50 },
      { page: 'https://www.x.com/products/p1', impressions: 300 },
      { page: 'https://www.x.com/', impressions: 20 },
    ]);
    expect(groups.map((g) => g.name)).toEqual(['Products', 'Blog', 'Homepage']);
    expect(groups[0]!.rules[0]).toEqual({ dimension: 'page', op: 'contains', value: '/products/' });
    expect(groups[2]!.rules[0]).toEqual({
      dimension: 'page',
      op: 'regex',
      value: '^https?://[^/]+/?$',
    });
  });
});

describe('autoTopicClusters', () => {
  it('builds head-term clusters, excludes stopwords + brand, is deterministic', () => {
    const queries = [
      { query: 'car insurance quote', impressions: 100 },
      { query: 'cheap car insurance', impressions: 90 },
      { query: 'home insurance cost', impressions: 40 },
      { query: 'acme login', impressions: 30 }, // acme = brand → dropped; "login" survives
    ];
    const clusters = autoTopicClusters(queries, { brandTerms: ['acme'] });
    const names = clusters.map((c) => c.name);
    // "insurance" is the highest-weighted shared term → first cluster.
    expect(names[0]).toBe('insurance');
    expect(clusters[0]!.rules[0]).toEqual({
      dimension: 'query',
      op: 'contains',
      value: 'insurance',
    });
    expect(names).toContain('login');
    expect(names).not.toContain('acme');
    // Deterministic: same input → same output.
    expect(autoTopicClusters(queries, { brandTerms: ['acme'] }).map((c) => c.name)).toEqual(names);
  });

  it('returns nothing when every term is a stopword or brand', () => {
    expect(autoTopicClusters([{ query: 'the best', impressions: 10 }])).toEqual([]);
  });
});
