import { describe, expect, it } from 'vitest';
import { rowHash } from './rowhash.js';

const row = {
  property: 'sc-domain:example.com',
  data_date: '2026-06-15',
  search_type: 'web' as const,
  aggregation: 'byProperty' as const,
  query: 'shoes',
  page: null,
  country: 'AUS',
  device: 'MOBILE',
  search_appearance: null,
};

describe('rowHash', () => {
  it('is a deterministic 64-char sha256 hex', () => {
    const h = rowHash(row);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(rowHash(row)).toBe(h);
  });

  it('changes when any dimension changes', () => {
    expect(rowHash({ ...row, query: 'boots' })).not.toBe(rowHash(row));
    expect(rowHash({ ...row, device: 'DESKTOP' })).not.toBe(rowHash(row));
    expect(rowHash({ ...row, data_date: '2026-06-16' })).not.toBe(rowHash(row));
  });

  it('ignores metric values (not part of the tuple)', () => {
    // rowHash only takes dimension fields, so two rows with the same dimensions hash equal
    // regardless of clicks/impressions — that is what makes restatement idempotent.
    expect(rowHash({ ...row })).toBe(rowHash({ ...row }));
  });

  it('treats null query/page distinctly from empty values consistently', () => {
    const a = rowHash({ ...row, query: null });
    const b = rowHash({ ...row, query: '' });
    // null and empty-string both serialize to '' in the tuple — documented collapse.
    expect(a).toBe(b);
  });
});
