import { describe, expect, it } from 'vitest';
import { disambiguatedTableName, sanitizeTableName } from './sanitize.js';

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

describe('disambiguatedTableName', () => {
  // Two distinct URLs that sanitize to the SAME base (path separators collapse identically).
  const a = 'https://example.com/a-b';
  const b = 'https://example.com/a_b';

  it('the two URLs collide on the base name', () => {
    expect(sanitizeTableName(a)).toBe(sanitizeTableName(b));
  });

  it('produces distinct, base-prefixed, stable names for colliding URLs', () => {
    const da = disambiguatedTableName(a);
    const db = disambiguatedTableName(b);
    expect(da).not.toBe(db);
    expect(da.startsWith(sanitizeTableName(a))).toBe(true);
    expect(disambiguatedTableName(a)).toBe(da); // deterministic
  });
});
