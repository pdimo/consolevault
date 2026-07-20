import { describe, expect, it } from 'vitest';
import {
  brandMatchExpr,
  brandSplitSql,
  brandTimeseriesSql,
  compileFilters,
  comparisonWindow,
  groupMatchExpr,
  fromTable,
  fromUnion,
  kpisSql,
  timeseriesSql,
} from './analytics.js';

const base = { start: '2026-05-01', end: '2026-05-28' };

describe('groupMatchExpr', () => {
  it('ORs rules across ops, targeting page or query, case-insensitively', () => {
    const params: Record<string, unknown> = {};
    const expr = groupMatchExpr(
      [
        { dimension: 'page', op: 'starts_with', value: '/blog/' },
        { dimension: 'query', op: 'contains', value: 'Pricing' },
        { dimension: 'query', op: 'regex', value: '^how' },
      ],
      params,
    );
    expect(expr).toBe(
      '(LOWER(page) LIKE @g0 OR LOWER(query) LIKE @g1 OR REGEXP_CONTAINS(LOWER(query), @g2))',
    );
    expect(params).toEqual({ g0: '/blog/%', g1: '%pricing%', g2: '^how' });
  });

  it('returns empty for no usable rules', () => {
    expect(groupMatchExpr([{ dimension: 'page', op: 'contains', value: '  ' }], {})).toBe('');
  });
});

describe('comparisonWindow', () => {
  it("defaults to the immediately-preceding same-length window ('previous')", () => {
    // base is a 28-day window (May 1–28) → previous is Apr 3–30.
    expect(comparisonWindow(base)).toEqual({ start: '2026-04-03', end: '2026-04-30' });
  });

  it('returns null for mode none', () => {
    expect(comparisonWindow({ ...base, compareMode: 'none' })).toBeNull();
  });

  it('shifts a calendar year for yoy, and 364 days when matching weekdays', () => {
    expect(comparisonWindow({ ...base, compareMode: 'yoy' })).toEqual({
      start: '2025-05-01',
      end: '2025-05-28',
    });
    expect(comparisonWindow({ ...base, compareMode: 'yoy', matchWeekdays: true })).toEqual({
      start: '2025-05-02',
      end: '2025-05-29',
    });
  });

  it('shifts one calendar month for prev_month, clamping end-of-month', () => {
    expect(
      comparisonWindow({ start: '2026-03-31', end: '2026-03-31', compareMode: 'prev_month' }),
    ).toEqual({
      start: '2026-02-28',
      end: '2026-02-28',
    });
  });

  it('uses explicit dates for custom, or null when incomplete', () => {
    expect(
      comparisonWindow({
        ...base,
        compareMode: 'custom',
        compareStart: '2026-01-01',
        compareEnd: '2026-01-28',
      }),
    ).toEqual({ start: '2026-01-01', end: '2026-01-28' });
    expect(comparisonWindow({ ...base, compareMode: 'custom' })).toBeNull();
  });
});

describe('preset filters', () => {
  it('paa matches question-shaped queries; longtail requires ≥4 words', () => {
    const paa = compileFilters({ ...base, presets: ['paa'] });
    expect(paa.where).toContain('REGEXP_CONTAINS(LOWER(query)');
    const longtail = compileFilters({ ...base, presets: ['longtail'] });
    expect(longtail.where).toContain('ARRAY_LENGTH(SPLIT(TRIM(query), " ")) >= 4');
  });
});

describe('compileFilters', () => {
  it('always constrains search_type + date range, defaulting searchType to web', () => {
    const { where, params } = compileFilters(base);
    expect(where).toContain('search_type = @searchType');
    expect(where).toContain('data_date BETWEEN @start AND @end');
    expect(params.searchType).toBe('web');
    expect(params.start).toBe('2026-05-01');
  });

  it('adds device/country/position/finalOnly filters', () => {
    const { where, params } = compileFilters({
      ...base,
      device: ['MOBILE'],
      country: ['aus'],
      positionMin: 11,
      positionMax: 20,
      finalOnly: true,
    });
    expect(where).toContain('device IN UNNEST(@device)');
    expect(where).toContain('country IN UNNEST(@country)');
    expect(where).toContain('position >= @posMin');
    expect(where).toContain('position <= @posMax');
    expect(where).toContain("data_state = 'final'");
    expect(params.device).toEqual(['MOBILE']);
    expect(params.posMin).toBe(11);
  });

  it('compiles comma-list query contains (OR) and brand excludes (NOT LIKE)', () => {
    const { where, params } = compileFilters({
      ...base,
      query: 'shoes, boots',
      brandExclude: ['nike'],
    });
    expect(where).toContain('LOWER(query) LIKE @q0 OR LOWER(query) LIKE @q1');
    expect(params.q0).toBe('%shoes%');
    expect(params.q1).toBe('%boots%');
    expect(where).toContain('LOWER(query) NOT LIKE @b0');
    expect(params.b0).toBe('%nike%');
  });

  it('adds NOT NULL guards when requested', () => {
    expect(compileFilters(base, { requireQuery: true }).where).toContain('query IS NOT NULL');
    expect(compileFilters(base, { requirePage: true }).where).toContain('page IS NOT NULL');
  });

  it('applies the brand segment (contains-any) at query time', () => {
    const brand = compileFilters({
      ...base,
      segment: 'brand',
      brandTerms: ['adt', 'adt security'],
    });
    expect(brand.where).toContain('LOWER(query) LIKE @bt0 OR LOWER(query) LIKE @bt1');
    expect(brand.params.bt0).toBe('%adt%');
    expect(brand.params.bt1).toBe('%adt security%');
  });

  it('non-brand segment negates the brand match and excludes null queries', () => {
    const { where } = compileFilters({ ...base, segment: 'nonbrand', brandTerms: ['adt'] });
    expect(where).toContain('(query IS NOT NULL AND NOT (LOWER(query) LIKE @bt0))');
  });

  it('ignores the segment when no brand terms are defined', () => {
    const { where } = compileFilters({ ...base, segment: 'brand', brandTerms: [] });
    expect(where).not.toContain('@bt0');
  });
});

describe('brand split', () => {
  it('brandMatchExpr ORs case-insensitive LIKEs and registers params', () => {
    const params: Record<string, unknown> = {};
    const expr = brandMatchExpr(['ADT', ' Foo '], params);
    expect(expr).toBe('(LOWER(query) LIKE @bt0 OR LOWER(query) LIKE @bt1)');
    expect(params.bt0).toBe('%adt%');
    expect(params.bt1).toBe('%foo%');
    expect(brandMatchExpr([], params)).toBe('');
  });

  it('splits into brand/non-brand rows and excludes null queries', () => {
    const sql = brandSplitSql('`t`', 'WHERE 1=1', '(LOWER(query) LIKE @bt0)');
    expect(sql).toContain("IF((LOWER(query) LIKE @bt0), 'brand', 'nonbrand') AS segment");
    expect(sql).toContain('AND query IS NOT NULL');
    expect(sql).toContain('GROUP BY segment');
  });

  it('brand timeseries splits clicks per day by segment', () => {
    const sql = brandTimeseriesSql('`t`', 'WHERE 1=1', '(LOWER(query) LIKE @bt0)', 'week');
    expect(sql).toContain('SUM(IF((LOWER(query) LIKE @bt0), clicks, 0)) AS brand');
    expect(sql).toContain('SUM(IF(NOT (LOWER(query) LIKE @bt0), clicks, 0)) AS nonbrand');
    expect(sql).toContain('DATE_TRUNC(data_date, WEEK(MONDAY))');
  });
});

describe('sources + builders', () => {
  it('builds a property table ref and a group union', () => {
    expect(fromTable('p', 'gsc_byProperty', 'urlp_x')).toBe('`p.gsc_byProperty.urlp_x`');
    expect(fromUnion('p', 'gsc_byProperty', ['a', 'b'])).toBe(
      '(SELECT * FROM `p.gsc_byProperty.a` UNION ALL SELECT * FROM `p.gsc_byProperty.b`)',
    );
  });

  it('kpis uses impression-weighted ctr + position', () => {
    const sql = kpisSql('`t`', 'WHERE 1=1');
    expect(sql).toContain('SAFE_DIVIDE(SUM(clicks), SUM(impressions)) AS ctr');
    expect(sql).toContain('SAFE_DIVIDE(SUM(position * impressions), SUM(impressions)) AS position');
  });

  it('timeseries buckets by week/month', () => {
    expect(timeseriesSql('`t`', 'WHERE 1=1', 'week')).toContain(
      'DATE_TRUNC(data_date, WEEK(MONDAY))',
    );
    expect(timeseriesSql('`t`', 'WHERE 1=1', 'month')).toContain('DATE_TRUNC(data_date, MONTH)');
    expect(timeseriesSql('`t`', 'WHERE 1=1', 'day')).toContain('FORMAT_DATE');
  });
});
