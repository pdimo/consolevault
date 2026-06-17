import { describe, expect, it } from 'vitest';
import { DATASETS, GSC_ROW_SCHEMA, PARTITION_FIELD, TASK_LOGS_SCHEMA } from './schema.js';

describe('bq schema constants', () => {
  it('declares the five datasets from SPEC §6.1', () => {
    expect(Object.values(DATASETS)).toEqual([
      'gsc_byProperty',
      'gsc_byPage',
      'gsc_totals',
      'gsc_views',
      'task_logs',
    ]);
  });

  it('partitions GSC data tables on data_date', () => {
    expect(PARTITION_FIELD).toBe('data_date');
    expect(GSC_ROW_SCHEMA.some((f) => f.name === PARTITION_FIELD && f.type === 'DATE')).toBe(true);
  });

  it('keeps query and page nullable (Discover/totals lack query; only byPage has page)', () => {
    const byName = Object.fromEntries(GSC_ROW_SCHEMA.map((f) => [f.name, f]));
    expect(byName.query?.mode).toBe('NULLABLE');
    expect(byName.page?.mode).toBe('NULLABLE');
  });

  it('has a row_hash column for the dedup guard', () => {
    expect(GSC_ROW_SCHEMA.some((f) => f.name === 'row_hash')).toBe(true);
  });

  it('task_logs is keyed by task_id and timestamped', () => {
    const names = TASK_LOGS_SCHEMA.map((f) => f.name);
    expect(names).toContain('task_id');
    expect(names).toContain('logged_at');
  });
});
