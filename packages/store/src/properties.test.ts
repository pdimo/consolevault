import { describe, expect, it } from 'vitest';
import type { Property } from '@consolevault/types';
import {
  DEFAULT_COLLECTION_CONFIG,
  discoveredFromSite,
  mergeDiscoveredProperty,
} from './properties.js';

const NOW = '2026-06-18T00:00:00.000Z';
const LATER = '2026-07-01T00:00:00.000Z';

describe('discoveredFromSite', () => {
  it('derives id, type, and table name from the site url', () => {
    const d = discoveredFromSite('acc-1', { siteUrl: 'sc-domain:example.com' }, NOW);
    expect(d).toMatchObject({
      id: 'domain_example_com',
      sanitizedTableName: 'domain_example_com',
      propertyType: 'domain',
      accountId: 'acc-1',
    });
  });
});

describe('mergeDiscoveredProperty', () => {
  it('creates a new property defaulting to excluded with default config', () => {
    const d = discoveredFromSite(
      'acc-1',
      { siteUrl: 'https://x.com/', permissionLevel: 'siteOwner' },
      NOW,
    );
    const p = mergeDiscoveredProperty(undefined, d);
    expect(p.included).toBe(false);
    expect(p.accountIds).toEqual(['acc-1']);
    expect(p.preferredAccountId).toBe('acc-1');
    expect(p.config).toEqual(DEFAULT_COLLECTION_CONFIG);
    expect(p.permissionLevel).toBe('siteOwner');
    expect(p.discoveredAt).toBe(NOW);
    expect(p.lastSeenAt).toBe(NOW);
  });

  it('accumulates accountIds and preserves admin choices on re-discovery', () => {
    const existing: Property = {
      id: 'urlp_x_com',
      siteUrl: 'https://x.com/',
      propertyType: 'url_prefix',
      sanitizedTableName: 'urlp_x_com',
      included: true,
      accountIds: ['acc-1'],
      preferredAccountId: 'acc-1',
      config: { ...DEFAULT_COLLECTION_CONFIG, types: ['web', 'image'] },
      discoveredAt: NOW,
      lastSeenAt: NOW,
    };
    const d = discoveredFromSite('acc-2', { siteUrl: 'https://x.com/' }, LATER);
    const merged = mergeDiscoveredProperty(existing, d);
    expect(merged.accountIds.sort()).toEqual(['acc-1', 'acc-2']);
    expect(merged.included).toBe(true); // admin choice preserved
    expect(merged.preferredAccountId).toBe('acc-1'); // preserved
    expect(merged.config.types).toEqual(['web', 'image']); // preserved
    expect(merged.discoveredAt).toBe(NOW); // first-seen preserved
    expect(merged.lastSeenAt).toBe(LATER); // refreshed
  });

  it('does not duplicate an account already present', () => {
    const existing: Property = {
      id: 'urlp_x_com',
      siteUrl: 'https://x.com/',
      propertyType: 'url_prefix',
      sanitizedTableName: 'urlp_x_com',
      included: false,
      accountIds: ['acc-1'],
      config: DEFAULT_COLLECTION_CONFIG,
    };
    const d = discoveredFromSite('acc-1', { siteUrl: 'https://x.com/' }, LATER);
    expect(mergeDiscoveredProperty(existing, d).accountIds).toEqual(['acc-1']);
  });
});
