import { describe, expect, it } from 'vitest';
import {
  buildQuery,
  dimensionsFor,
  isDayFinal,
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

  it('discover drops the query dimension and rejects byProperty', () => {
    expect(dimensionsFor('byPage', 'discover')).toEqual(['page', 'country', 'device']);
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
