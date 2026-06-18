import { describe, expect, it } from 'vitest';
import type { Task } from '@consolevault/types';
import { coverageState, detectDoubleCount } from './coverage.js';

describe('coverageState', () => {
  it('maps a task to its status; missing task → not_planned', () => {
    expect(coverageState({ status: 'collected_with_data' } as Task)).toBe('collected_with_data');
    expect(coverageState(undefined)).toBe('not_planned');
  });
});

describe('detectDoubleCount', () => {
  it('warns when a domain and a same-domain url-prefix child are both present', () => {
    expect(
      detectDoubleCount([
        { siteUrl: 'sc-domain:example.com', propertyType: 'domain' },
        { siteUrl: 'https://www.example.com/', propertyType: 'url_prefix' },
      ]),
    ).toBe(true);
  });

  it('does not warn for unrelated properties', () => {
    expect(
      detectDoubleCount([
        { siteUrl: 'sc-domain:example.com', propertyType: 'domain' },
        { siteUrl: 'https://www.other.com/', propertyType: 'url_prefix' },
      ]),
    ).toBe(false);
  });

  it('does not warn without a domain property', () => {
    expect(
      detectDoubleCount([
        { siteUrl: 'https://a.com/', propertyType: 'url_prefix' },
        { siteUrl: 'https://b.com/', propertyType: 'url_prefix' },
      ]),
    ).toBe(false);
  });
});
