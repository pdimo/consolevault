import { describe, expect, it } from 'vitest';
import {
  brandMatchExpr,
  compileBrandPattern,
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

  it('applies the brand segment at query time', () => {
    const brand = compileFilters({
      ...base,
      segment: 'brand',
      brandTerms: ['adt', 'adt security'],
    });
    expect(brand.where).toContain('REGEXP_CONTAINS(LOWER(query), @brandRe)');
    expect(brand.params.brandRe).toBe(
      String.raw`(?i)\badt(?:'s|’s|s)?\b|\badt\s+security(?:'s|’s|s)?\b`,
    );
  });

  it('non-brand segment negates the brand match and excludes null queries', () => {
    const { where } = compileFilters({ ...base, segment: 'nonbrand', brandTerms: ['adt'] });
    expect(where).toContain('(query IS NOT NULL AND NOT REGEXP_CONTAINS(LOWER(query), @brandRe))');
  });

  it('ignores the segment when no brand terms are defined', () => {
    const { where } = compileFilters({ ...base, segment: 'brand', brandTerms: [] });
    expect(where).not.toContain('@brandRe');
  });
});

describe('compileBrandPattern', () => {
  /** Run the compiled RE2-ish pattern through JS RegExp — close enough to assert match semantics. */
  const matches = (terms: string[], query: string): boolean => {
    const src = compileBrandPattern(terms);
    return new RegExp(src.replace('(?i)', ''), 'i').test(query.toLowerCase());
  };

  it('matches a literal term as a whole word, not as a substring', () => {
    expect(matches(['adt'], 'adt alarm cost')).toBe(true);
    expect(matches(['adt'], 'adt-security review')).toBe(true);
    expect(matches(['adt'], 'adtran switches')).toBe(false);
    expect(matches(['adt'], 'best gadget 2026')).toBe(false);
  });

  it('allows a plural or possessive on a literal term', () => {
    expect(matches(['nike'], 'nikes on sale')).toBe(true);
    expect(matches(['nike'], "nike's returns policy")).toBe(true);
    expect(matches(['nike'], 'nikeplus app')).toBe(false);
  });

  it('escapes regex metacharacters in literal terms and loosens internal spaces', () => {
    expect(matches(['adt.com.au'], 'adt.com.au login')).toBe(true);
    expect(matches(['adt.com.au'], 'adtxcomxau login')).toBe(false);
    expect(matches(['adt  security'], 'adt security reviews')).toBe(true);
  });

  it('takes a /slash-wrapped/ term as a regex verbatim', () => {
    expect(compileBrandPattern(['/adt ?security/'])).toBe('(?i)(?:adt ?security)');
    expect(matches(['/adt ?security/'], 'adtsecurity au')).toBe(true);
    expect(matches(['/^adt/'], 'adt alarms')).toBe(true);
    expect(matches(['/^adt/'], 'cheap adt alarms')).toBe(false);
  });

  it('falls back to a literal when a /regex/ is not runnable by RE2', () => {
    // Unbalanced group, and a lookahead RE2 rejects: neither may break the whole report.
    expect(compileBrandPattern(['/adt(/'])).toBe(String.raw`(?i)/adt\(/`);
    expect(compileBrandPattern(['/adt(?=x)/'])).toBe(String.raw`(?i)/adt\(\?=x\)/`);
  });

  it('ignores blank terms and returns no pattern when nothing is left', () => {
    expect(compileBrandPattern([' ', ''])).toBe('');
    expect(compileBrandPattern([])).toBe('');
  });
});

describe('brand split', () => {
  it('brandMatchExpr registers one compiled pattern and is idempotent', () => {
    const params: Record<string, unknown> = {};
    const expr = brandMatchExpr(['ADT', ' Foo '], params);
    expect(expr).toBe('REGEXP_CONTAINS(LOWER(query), @brandRe)');
    expect(params.brandRe).toBe(compileBrandPattern(['adt', 'foo']));
    // Re-registering the same terms (segment filter + brand split share a params bag) is a no-op.
    expect(brandMatchExpr(['ADT', ' Foo '], params)).toBe(expr);
    expect(Object.keys(params)).toEqual(['brandRe']);
    expect(brandMatchExpr([], params)).toBe('');
  });

  it('splits into brand/non-brand rows and excludes null queries', () => {
    const sql = brandSplitSql('`t`', 'WHERE 1=1', 'REGEXP_CONTAINS(LOWER(query), @brandRe)');
    expect(sql).toContain(
      "IF(REGEXP_CONTAINS(LOWER(query), @brandRe), 'brand', 'nonbrand') AS segment",
    );
    expect(sql).toContain('AND query IS NOT NULL');
    expect(sql).toContain('GROUP BY segment');
  });

  it('brand timeseries splits clicks and impressions per bucket by segment', () => {
    const expr = 'REGEXP_CONTAINS(LOWER(query), @brandRe)';
    const sql = brandTimeseriesSql('`t`', 'WHERE 1=1', expr, 'week');
    expect(sql).toContain(`SUM(IF(${expr}, clicks, 0)) AS brand`);
    expect(sql).toContain(`SUM(IF(NOT ${expr}, clicks, 0)) AS nonbrand`);
    expect(sql).toContain(`SUM(IF(${expr}, impressions, 0)) AS brandImpr`);
    expect(sql).toContain(`SUM(IF(NOT ${expr}, impressions, 0)) AS nonbrandImpr`);
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
