import type { Property } from '@consolevault/types';

export type StatusKind = 'error' | 'final' | 'fresh' | 'collecting' | 'untracked' | 'imported';
export type StatusTone = 'ok' | 'warn' | 'bad' | 'fresh' | 'neutral';

export interface DerivedStatus {
  kind: StatusKind;
  label: string;
  tone: StatusTone;
  date?: string;
}

/**
 * Derive a single, human-friendly collection-status chip for a property from its denormalized
 * `status` (Stage 7). Pure — unit-tested. An error counts only if it's more recent than the last
 * successful collection (a later success supersedes it).
 */
export function propertyStatus(p: Property): DerivedStatus {
  // Native Bulk Export imports aren't collected — data lands via Google's export, read through
  // adapter views (SPEC §12). Show a distinct, always-current chip rather than collection state.
  if (p.source === 'native_export') {
    return { kind: 'imported', label: 'BigQuery export', tone: 'ok' };
  }
  const s = p.status;
  const erroredAfterCollect =
    s?.lastErrorAt && (!s.lastCollectedAt || s.lastErrorAt > s.lastCollectedAt);
  if (erroredAfterCollect) return { kind: 'error', label: 'Error', tone: 'bad' };
  if (s?.lastCollectedDate) {
    return s.dataState === 'fresh'
      ? {
          kind: 'fresh',
          label: `Fresh · ${s.lastCollectedDate}`,
          tone: 'fresh',
          date: s.lastCollectedDate,
        }
      : {
          kind: 'final',
          label: `Final · ${s.lastCollectedDate}`,
          tone: 'ok',
          date: s.lastCollectedDate,
        };
  }
  if (p.included) return { kind: 'collecting', label: 'Collecting…', tone: 'warn' };
  return { kind: 'untracked', label: 'Not tracked', tone: 'neutral' };
}
