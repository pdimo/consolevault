import { describe, expect, it } from 'vitest';
import type { Property } from '@consolevault/types';
import { propertyStatus } from './propertyStatus';

const base: Property = {
  id: 'urlp_x',
  siteUrl: 'https://x.com/',
  propertyType: 'url_prefix',
  sanitizedTableName: 'urlp_x',
  included: true,
  accountIds: ['a'],
  config: { types: ['web'], aggregations: ['byProperty'], offsetDays: 2, backfillMonths: 16 },
};

describe('propertyStatus', () => {
  it('untracked when not included and never collected', () => {
    expect(propertyStatus({ ...base, included: false }).kind).toBe('untracked');
  });

  it('collecting when tracked but no data yet', () => {
    expect(propertyStatus(base).kind).toBe('collecting');
  });

  it('final / fresh from the last collected day', () => {
    expect(
      propertyStatus({ ...base, status: { lastCollectedDate: '2026-06-10', dataState: 'final' } })
        .kind,
    ).toBe('final');
    expect(
      propertyStatus({ ...base, status: { lastCollectedDate: '2026-06-19', dataState: 'fresh' } })
        .kind,
    ).toBe('fresh');
  });

  it('error only when more recent than the last collection', () => {
    expect(
      propertyStatus({
        ...base,
        status: {
          lastCollectedAt: '2026-06-19T00:00:00Z',
          lastErrorAt: '2026-06-19T01:00:00Z',
          lastError: 'x',
        },
      }).kind,
    ).toBe('error');
    // a later success supersedes an earlier error
    expect(
      propertyStatus({
        ...base,
        status: {
          lastCollectedDate: '2026-06-19',
          dataState: 'final',
          lastCollectedAt: '2026-06-19T02:00:00Z',
          lastErrorAt: '2026-06-19T01:00:00Z',
        },
      }).kind,
    ).toBe('final');
  });
});
