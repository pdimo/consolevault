import { describe, expect, it } from 'vitest';
import { buildUnionViewSql } from './views.js';

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
