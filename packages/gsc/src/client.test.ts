import { describe, expect, it } from 'vitest';
import {
  buildQuery,
  dimensionsFor,
  isDayFinal,
  isValidCombo,
  mapRowsToGscRows,
  type SearchAnalyticsQueryParams,
} from './client.js';

const base: SearchAnalyticsQueryParams = {
  siteUrl: 'sc-domain:example.com',
  startDate: '2026-06-15',
  endDate: '2026-06-15',
  searchType: 'web',
  aggregation: 'byProperty',
  startRow: 0,
  rowLimit: 25000,
};

describe('dimensionsFor', () => {
  it('byProperty → query/country/device; byPage adds page', () => {
    expect(dimensionsFor('byProperty', 'web')).toEqual(['query', 'country', 'device']);
    expect(dimensionsFor('byPage', 'web')).toEqual(['query', 'page', 'country', 'device']);
  });

  it('totals has no dimensions', () => {
    expect(dimensionsFor('totals', 'web')).toEqual([]);
  });

  it('discover is page/country only (no query, no device) and rejects byProperty', () => {
    expect(dimensionsFor('byPage', 'discover')).toEqual(['page', 'country']);
    expect(() => dimensionsFor('byProperty', 'discover')).toThrow(/byProperty/);
  });

  it('googleNews rejects byProperty', () => {
    expect(() => dimensionsFor('byProperty', 'googleNews')).toThrow(/byProperty/);
  });
});

describe('buildQuery', () => {
  it('builds a final-state byProperty/web body', () => {
    expect(buildQuery(base)).toEqual({
      startDate: '2026-06-15',
      endDate: '2026-06-15',
      type: 'web',
      dimensions: ['query', 'country', 'device'],
      aggregationType: 'byProperty',
      rowLimit: 25000,
      startRow: 0,
      dataState: 'all',
    });
  });
});

describe('isDayFinal', () => {
  it('is final when the day precedes first_incomplete_date', () => {
    expect(isDayFinal('2026-06-10', '2026-06-15')).toBe(true);
  });
  it('is fresh when the day is on/after first_incomplete_date', () => {
    expect(isDayFinal('2026-06-15', '2026-06-15')).toBe(false);
    expect(isDayFinal('2026-06-16', '2026-06-15')).toBe(false);
  });
  it('is final when there is no incomplete boundary', () => {
    expect(isDayFinal('2026-06-15', null)).toBe(true);
  });
});

describe('mapRowsToGscRows', () => {
  it('maps keys to columns by dimension order, leaving page/appearance null', () => {
    const rows = mapRowsToGscRows(
      [{ keys: ['shoes', 'AUS', 'MOBILE'], clicks: 5, impressions: 100, ctr: 0.05, position: 3.2 }],
      base,
      '2026-06-18T00:00:00.000Z',
      true,
    );
    expect(rows[0]).toMatchObject({
      data_date: '2026-06-15',
      property: 'sc-domain:example.com',
      property_type: 'domain',
      search_type: 'web',
      aggregation: 'byProperty',
      query: 'shoes',
      country: 'AUS',
      device: 'MOBILE',
      page: null,
      search_appearance: null,
      clicks: 5,
      impressions: 100,
      is_anonymized: false,
      data_state: 'final',
    });
  });
});

describe('dimensionsFor per type', () => {
  it('gives web/image/etc the full dimension set', () => {
    expect(dimensionsFor('byProperty', 'web')).toEqual(['query', 'country', 'device']);
    expect(dimensionsFor('byPage', 'image')).toEqual(['query', 'page', 'country', 'device']);
  });

  it('restricts discover & googleNews to page/country (no query, no device)', () => {
    expect(dimensionsFor('byPage', 'discover')).toEqual(['page', 'country']);
    expect(dimensionsFor('byPage', 'googleNews')).toEqual(['page', 'country']);
  });

  it('throws on unsupported byProperty for discover/googleNews', () => {
    expect(() => dimensionsFor('byProperty', 'discover')).toThrow();
  });
});

describe('isValidCombo', () => {
  it('allows all aggregations for web/image/video/news', () => {
    for (const t of ['web', 'image', 'video', 'news'] as const) {
      expect(isValidCombo(t, 'byProperty')).toBe(true);
      expect(isValidCombo(t, 'byPage')).toBe(true);
      expect(isValidCombo(t, 'totals')).toBe(true);
    }
  });

  it('allows only byPage for discover and googleNews', () => {
    for (const t of ['discover', 'googleNews'] as const) {
      expect(isValidCombo(t, 'byPage')).toBe(true);
      expect(isValidCombo(t, 'byProperty')).toBe(false);
      expect(isValidCombo(t, 'totals')).toBe(false);
    }
  });
});
