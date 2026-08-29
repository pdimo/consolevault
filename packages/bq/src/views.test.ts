import { describe, expect, it } from 'vitest';
import {
  buildRankBucketViewSql,
  buildUnionViewSql,
  buildWildcardViewSql,
  RANK_BUCKET_VIEWS,
  WILDCARD_VIEWS,
} from './views.js';

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

describe('buildRankBucketViewSql', () => {
  it('rolls the byPage wildcard up to day × property × page × bucket', () => {
    const sql = buildRankBucketViewSql('proj', 'byPage_all', 'page');
    expect(sql).toContain('`proj.gsc_views.byPage_all`');
    expect(sql).toContain('COUNT(DISTINCT query) AS queries');
    expect(sql).toContain(
      'GROUP BY data_date, source_table, search_type, data_state, page, rank_bucket, rank_bucket_index',
    );
  });

  it('drops the entity dimension for the property-level daily distribution', () => {
    const sql = buildRankBucketViewSql('proj', 'byProperty_all', null);
    expect(sql).toContain(
      'GROUP BY data_date, source_table, search_type, data_state, rank_bucket, rank_bucket_index',
    );
    expect(sql).not.toContain('  page,');
  });

  it('excludes query-less rows, which have nothing to bucket', () => {
    expect(buildRankBucketViewSql('proj', 'byPage_all', 'page')).toContain(
      'WHERE query IS NOT NULL',
    );
  });

  it('exposes a sortable ordinal beside the label, since BI sorts strings alphabetically', () => {
    const sql = buildRankBucketViewSql('proj', 'byPage_all', 'page');
    expect(sql).toContain('AS rank_bucket');
    expect(sql).toContain('AS rank_bucket_index');
  });

  it('derives one view per wildcard source', () => {
    expect(RANK_BUCKET_VIEWS.map((v) => v.viewId)).toEqual([
      'rank_buckets_daily',
      'rank_buckets_by_page',
    ]);
    const sources = new Set(WILDCARD_VIEWS.map((w) => w.viewId));
    for (const v of RANK_BUCKET_VIEWS) expect(sources.has(v.source)).toBe(true);
  });
});
