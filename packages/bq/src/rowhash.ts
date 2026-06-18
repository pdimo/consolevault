/**
 * Row hash — the belt-and-braces dedup guard (SPEC §6.3, §9).
 *
 * `row_hash = sha256(property|data_date|search_type|aggregation|query|page|country|device|
 * search_appearance)`. Hashes the dimension tuple only (not metrics), so a restated day's
 * metric changes reuse the same hash and the standing invariant (one row per hash) holds.
 */

import { createHash } from 'node:crypto';
import type { GscRow } from '@consolevault/types';

/** The dimension fields that identify a row, in canonical order. */
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
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}
