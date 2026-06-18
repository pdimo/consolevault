/**
 * Row hash — the belt-and-braces dedup guard (SPEC §6.3, §9).
 *
 * `row_hash = sha256(property|data_date|search_type|aggregation|query|page|country|device|
 * search_appearance|is_anonymized)`. Hashes the identity tuple only (not metrics), so a restated
 * day's metric changes reuse the same hash and the standing invariant (one row per hash) holds.
 *
 * `is_anonymized` is included (a small extension of SPEC §6.3's literal formula) so the `totals`
 * pass can store two same-dimension rows — the raw daily total and the anonymized-query delta —
 * without a hash collision. Delete-then-load makes the re-hash of existing rows safe.
 */

import { createHash } from 'node:crypto';
import type { GscRow } from '@consolevault/types';

/** The fields that identify a row, in canonical order. */
type RowDimensions = Pick<
  GscRow,
  | 'property'
  | 'data_date'
  | 'search_type'
  | 'aggregation'
  | 'query'
  | 'page'
  | 'country'
  | 'device'
  | 'search_appearance'
  | 'is_anonymized'
>;

export function rowHash(row: RowDimensions): string {
  const parts = [
    row.property,
    row.data_date,
    row.search_type,
    row.aggregation,
    row.query ?? '',
    row.page ?? '',
    row.country ?? '',
    row.device ?? '',
    row.search_appearance ?? '',
    String(row.is_anonymized),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
