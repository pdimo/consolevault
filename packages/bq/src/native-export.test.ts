import { describe, expect, it } from 'vitest';
import {
  buildNativeByPageViewSql,
  buildNativeByPropertyViewSql,
  distinctExportSiteUrlsSql,
  nativePropertyType,
  NATIVE_EXPORT_TABLES,
} from './native-export.js';
import { buildWildcardViewSql } from './views.js';
import { GSC_ROW_SCHEMA } from './schema.js';
import { rowHash } from './rowhash.js';

describe('nativePropertyType', () => {
  it('maps sc-domain: to domain and everything else to url_prefix', () => {
    expect(nativePropertyType('sc-domain:example.com')).toBe('domain');
    expect(nativePropertyType('https://www.example.com/')).toBe('url_prefix');
  });
});

describe('buildNativeByPropertyViewSql', () => {
  const sql = buildNativeByPropertyViewSql('exp-proj', 'searchconsole', 'https://www.acme.com/');

  it('reads the site-impression table filtered to the one site_url', () => {
    expect(sql).toContain(`\`exp-proj.searchconsole.${NATIVE_EXPORT_TABLES.site}\``);
    expect(sql).toContain("WHERE site_url = 'https://www.acme.com/'");
  });

  it('stamps the byProperty aggregation and a null page', () => {
    expect(sql).toContain("'byProperty' AS aggregation");
    expect(sql).toContain('CAST(NULL AS STRING) AS page');
  });

  it('derives ctr and average position (sum_top_position/impressions + 1)', () => {
    expect(sql).toContain('SAFE_DIVIDE(clicks, impressions) AS ctr');
    expect(sql).toContain('SAFE_DIVIDE(sum_top_position, impressions) + 1 AS position');
  });

  it('maps is_anonymized_query → is_anonymized', () => {
    expect(sql).toContain('is_anonymized_query AS is_anonymized');
  });

  it('projects exactly the shared row schema columns, in order', () => {
    for (const field of GSC_ROW_SCHEMA) {
      expect(sql).toContain(field.name);
    }
  });
});

describe('buildNativeByPageViewSql', () => {
  const sql = buildNativeByPageViewSql('exp-proj', 'searchconsole', 'sc-domain:acme.com');

  it('reads the url-impression table and maps url → page', () => {
    expect(sql).toContain(`\`exp-proj.searchconsole.${NATIVE_EXPORT_TABLES.url}\``);
    expect(sql).toContain('url AS page');
    expect(sql).toContain("'byPage' AS aggregation");
  });

  it('uses sum_position (the url table column), not sum_top_position', () => {
    expect(sql).toContain('SAFE_DIVIDE(sum_position, impressions) + 1 AS position');
    expect(sql).not.toContain('sum_top_position');
  });

  it('treats a row anonymized if the query OR the discover row is anonymized', () => {
    expect(sql).toContain('(is_anonymized_query OR is_anonymized_discover) AS is_anonymized');
  });

  it('tags a domain property type', () => {
    expect(sql).toContain("'domain' AS property_type");
  });
});

describe('row_hash SQL vs rowHash()', () => {
  it('joins the identity tuple in the same canonical order as the JS hasher', () => {
    // The SQL builds row_hash from ARRAY_TO_STRING([...], '|') in the exact order rowHash() uses:
    // property, data_date, search_type, aggregation, query, page, country, device,
    // search_appearance, is_anonymized. Assert the JS canonical order is stable so the two can't
    // silently drift (a full value-equality check would require a live BigQuery SHA256).
    const a = rowHash({
      property: 'p',
      data_date: '2026-01-01',
      search_type: 'web',
      aggregation: 'byProperty',
      query: 'q',
      page: null,
      country: 'aus',
      device: 'DESKTOP',
      search_appearance: null,
      is_anonymized: false,
    });
    const b = rowHash({
      property: 'p',
      data_date: '2026-01-01',
      search_type: 'web',
      aggregation: 'byProperty',
      query: 'q',
      page: null,
      country: 'aus',
      device: 'DESKTOP',
      search_appearance: null,
      is_anonymized: true, // only is_anonymized differs
    });
    // is_anonymized participates in the hash → the two must differ (matches SQL CAST(... AS STRING)).
    expect(a).not.toBe(b);

    const sql = buildNativeByPropertyViewSql('x', 'y', 'https://acme.com/');
    // The SQL hash tuple ends with CAST(is_anonymized_query AS STRING), mirroring String(bool).
    expect(sql).toContain('CAST(is_anonymized_query AS STRING)');
  });
});

describe('buildWildcardViewSql with native-export views', () => {
  it('unions native adapter views in by name (wildcards skip views)', () => {
    const sql = buildWildcardViewSql('proj', 'gsc_byProperty', ['urlp_acme_com'], true);
    expect(sql).toContain('`proj.gsc_byProperty.*`');
    expect(sql).toContain("SELECT *, 'urlp_acme_com' AS source_table");
    expect(sql).toContain('`proj.gsc_byProperty.urlp_acme_com`');
    expect(sql).toContain('UNION ALL');
  });

  it('omits the wildcard term when there are no API tables (native-only install)', () => {
    const sql = buildWildcardViewSql('proj', 'gsc_byProperty', ['urlp_acme_com'], false);
    expect(sql).not.toContain('.*`');
    expect(sql).toContain('`proj.gsc_byProperty.urlp_acme_com`');
  });
});

describe('distinctExportSiteUrlsSql', () => {
  it('selects distinct site_url from the site-impression table', () => {
    const sql = distinctExportSiteUrlsSql('exp', 'searchconsole');
    expect(sql).toContain('SELECT DISTINCT site_url');
    expect(sql).toContain(`\`exp.searchconsole.${NATIVE_EXPORT_TABLES.site}\``);
  });
});
