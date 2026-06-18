import { describe, expect, it } from 'vitest';
import { derivePropertyType } from './discovery.js';

describe('derivePropertyType', () => {
  it('tags sc-domain: properties as domain', () => {
    expect(derivePropertyType('sc-domain:example.com')).toBe('domain');
  });

  it('tags everything else as url_prefix', () => {
    expect(derivePropertyType('https://www.example.com/')).toBe('url_prefix');
    expect(derivePropertyType('http://example.com/blog/')).toBe('url_prefix');
  });
});
