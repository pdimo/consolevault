import { describe, expect, it } from 'vitest';
import {
  buildLookerTemplateUrl,
  buildScopedViewSql,
  buildTemplateDatasources,
  LOOKER_CALCULATED_FIELDS,
  LOOKER_CREATE_URL,
  LOOKER_TEMPLATE_VIEWS,
} from './looker.js';

/** Parse a built link back into a plain param map (values arrive decoded). */
function params(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URL(url).searchParams) out[k] = v;
  return out;
}

describe('LOOKER_TEMPLATE_VIEWS', () => {
  it('binds the three self-maintaining wildcard views', () => {
    expect(LOOKER_TEMPLATE_VIEWS.map((v) => v.viewId)).toEqual([
      'byProperty_all',
      'byPage_all',
      'totals_all',
    ]);
  });

  it('keeps aliases unique — they are the contract with a published template report', () => {
    const aliases = LOOKER_TEMPLATE_VIEWS.map((v) => v.alias);
    expect(new Set(aliases).size).toBe(aliases.length);
  });
});

describe('buildTemplateDatasources', () => {
  it('binds views by table reference when the report is agency-wide', () => {
    const ds = buildTemplateDatasources('proj');
    expect(ds).toHaveLength(3);
    expect(ds[0]).toMatchObject({
      alias: 'queries',
      type: 'TABLE',
      datasetId: 'gsc_views',
      tableId: 'byProperty_all',
    });
  });

  it('bakes the scope into SQL when the link is for specific properties', () => {
    const ds = buildTemplateDatasources('proj', { sourceTables: ['urlp_a_com'] });
    expect(ds.every((d) => d.type === 'CUSTOM_QUERY')).toBe(true);
    for (const d of ds) {
      if (d.type !== 'CUSTOM_QUERY') throw new Error('expected a query source');
      expect(d.sql).toContain("source_table IN ('urlp_a_com')");
    }
  });

  it('treats an empty scope as agency-wide rather than as "no properties"', () => {
    // A client whose properties have no tables yet must not get a link that filters everything out.
    expect(buildTemplateDatasources('proj', { sourceTables: [] })[0]?.type).toBe('TABLE');
  });
});

describe('buildScopedViewSql', () => {
  const sql = buildScopedViewSql('proj', 'byProperty_all', ['urlp_a_com', 'urlp_b_com'], 16);

  it('reads the wildcard view and scopes it to the given property tables', () => {
    expect(sql).toContain('`proj.gsc_views.byProperty_all`');
    expect(sql).toContain("source_table IN ('urlp_a_com', 'urlp_b_com')");
  });

  it('bounds the scan to the backfill window in Pacific Time', () => {
    expect(sql).toContain("DATE_SUB(CURRENT_DATE('America/Los_Angeles'), INTERVAL 16 MONTH)");
  });

  it('drops ingestion bookkeeping from the field picker', () => {
    expect(sql).toContain('SELECT * EXCEPT (row_hash, collected_at)');
  });

  it('never emits a zero/negative window that would scan nothing', () => {
    expect(buildScopedViewSql('proj', 'totals_all', ['urlp_a_com'], 0)).toContain('INTERVAL 1 MONTH');
    expect(buildScopedViewSql('proj', 'totals_all', ['urlp_a_com'], 2.7)).toContain(
      'INTERVAL 2 MONTH',
    );
  });

  it('refuses a table name that could carry SQL into the query', () => {
    expect(() => buildScopedViewSql('proj', 'totals_all', ["a' OR 1=1 --"], 16)).toThrow(
      /unsafe BigQuery identifier/,
    );
  });
});

describe('buildLookerTemplateUrl', () => {
  it('emits Linking API parameters for every bound data source', () => {
    const url = buildLookerTemplateUrl({
      projectId: 'my-proj',
      datasources: buildTemplateDatasources('my-proj'),
    });
    expect(url.startsWith(`${LOOKER_CREATE_URL}?`)).toBe(true);
    const p = params(url);
    expect(p['ds.queries.connector']).toBe('bigQuery');
    expect(p['ds.queries.type']).toBe('TABLE');
    expect(p['ds.queries.projectId']).toBe('my-proj');
    expect(p['ds.queries.datasetId']).toBe('gsc_views');
    expect(p['ds.queries.tableId']).toBe('byProperty_all');
    expect(p['ds.pages.tableId']).toBe('byPage_all');
    expect(p['ds.totals.tableId']).toBe('totals_all');
  });

  it('bills the deployment project unless a separate billing project is given', () => {
    const ds = buildTemplateDatasources('my-proj');
    expect(params(buildLookerTemplateUrl({ projectId: 'my-proj', datasources: ds }))[
      'ds.queries.billingProjectId'
    ]).toBe('my-proj');
    expect(
      params(
        buildLookerTemplateUrl({
          projectId: 'my-proj',
          billingProjectId: 'billing-proj',
          datasources: ds,
        }),
      )['ds.queries.billingProjectId'],
    ).toBe('billing-proj');
  });

  it('copies a published template report only when one is configured', () => {
    const ds = buildTemplateDatasources('my-proj');
    expect(
      params(buildLookerTemplateUrl({ projectId: 'my-proj', datasources: ds })),
    ).not.toHaveProperty('c.reportId');
    expect(
      params(
        buildLookerTemplateUrl({
          projectId: 'my-proj',
          datasources: ds,
          templateReportId: 'abc-123',
        }),
      )['c.reportId'],
    ).toBe('abc-123');
  });

  it('survives a round trip through URL parsing with SQL in a parameter', () => {
    const url = buildLookerTemplateUrl({
      projectId: 'my-proj',
      datasources: buildTemplateDatasources('my-proj', { sourceTables: ['urlp_a_com'] }),
      reportName: 'Acme — Search',
    });
    const p = params(url);
    expect(p['r.reportName']).toBe('Acme — Search');
    expect(p['ds.queries.type']).toBe('CUSTOM_QUERY');
    expect(p['ds.queries.sql']).toContain("source_table IN ('urlp_a_com')");
    expect(p['ds.queries.sql']).not.toContain('%20');
    expect(p).not.toHaveProperty('ds.queries.tableId');
  });
});

describe('LOOKER_CALCULATED_FIELDS', () => {
  it('re-derives the ratio metrics from summable columns rather than averaging averages', () => {
    const byName = new Map(LOOKER_CALCULATED_FIELDS.map((f) => [f.name, f.formula]));
    expect(byName.get('Avg position')).toBe('SUM(position * impressions) / SUM(impressions)');
    expect(byName.get('CTR')).toBe('SUM(clicks) / SUM(impressions)');
    for (const f of LOOKER_CALCULATED_FIELDS) expect(f.formula).not.toMatch(/\bAVG\(/);
  });
});
