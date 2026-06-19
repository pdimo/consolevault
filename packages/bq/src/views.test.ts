import { describe, expect, it } from 'vitest';
import { buildUnionViewSql, buildWildcardViewSql, WILDCARD_VIEWS } from './views.js';

describe('buildUnionViewSql', () => {
  const sql = buildUnionViewSql('proj', ['urlp_a_com', 'urlp_b_com']);

  it('unions all member byProperty tables', () => {
    expect(sql).toContain('`proj.gsc_byProperty.urlp_a_com`');
    expect(sql).toContain('`proj.gsc_byProperty.urlp_b_com`');
    expect(sql).toContain('UNION ALL');
  });

  it('sums clicks/impressions and re-weights ctr/position by impressions', () => {
    expect(sql).toContain('SUM(clicks)');
    expect(sql).toContain('SUM(impressions)');
    expect(sql).toContain('SAFE_DIVIDE(SUM(clicks), SUM(impressions))');
    expect(sql).toContain('SAFE_DIVIDE(SUM(position * impressions), SUM(impressions))');
    expect(sql).toContain('GROUP BY data_date, query, country, device');
  });
});

describe('buildWildcardViewSql', () => {
  it('selects across all tables in the dataset and exposes the source table', () => {
    const sql = buildWildcardViewSql('proj', 'gsc_byProperty');
    expect(sql).toContain('`proj.gsc_byProperty.*`');
    expect(sql).toContain('_TABLE_SUFFIX AS source_table');
  });

  it('covers the three data datasets with distinct view ids', () => {
    expect(WILDCARD_VIEWS.map((w) => w.viewId)).toEqual([
      'byProperty_all',
      'byPage_all',
      'totals_all',
    ]);
    expect(new Set(WILDCARD_VIEWS.map((w) => w.dataset)).size).toBe(3);
  });
});
