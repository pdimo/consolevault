import { describe, expect, it } from 'vitest';
import { sanitizeTableName } from './sanitize.js';

describe('sanitizeTableName', () => {
  it('prefixes domain properties and strips the sc-domain scheme', () => {
    expect(sanitizeTableName('sc-domain:example.com')).toBe('domain_example_com');
  });

  it('prefixes url-prefix properties and strips the protocol', () => {
    expect(sanitizeTableName('https://www.example.com/')).toBe('urlp_www_example_com');
    expect(sanitizeTableName('http://www.example.com/')).toBe('urlp_www_example_com');
  });

  it('encodes path segments and lowercases', () => {
    expect(sanitizeTableName('https://www.example.com/Blog/Posts-1/')).toBe(
      'urlp_www_example_com_blog_posts_1',
    );
  });

  it('keeps domain and same-host url-prefix distinct (no collision)', () => {
    expect(sanitizeTableName('sc-domain:example.com')).not.toBe(
      sanitizeTableName('https://example.com/'),
    );
  });

  it('is deterministic and idempotent for the same input', () => {
    const a = sanitizeTableName('https://shop.example.co.uk/au/');
    const b = sanitizeTableName('https://shop.example.co.uk/au/');
    expect(a).toBe(b);
    expect(a).toBe('urlp_shop_example_co_uk_au');
  });

  it('collapses non-alphanumerics (incl. IDN chars) to single underscores', () => {
    expect(sanitizeTableName('sc-domain:münchen.de')).toBe('domain_m_nchen_de');
  });
});
