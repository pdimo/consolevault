/**
 * Firestore (Native) is the control plane (SPEC §2). Mutable account/property/task state lives
 * here — never in BigQuery. Honors FIRESTORE_EMULATOR_HOST for tests.
 */

import { Firestore } from '@google-cloud/firestore';

export const COLLECTIONS = {
  accounts: 'accounts',
  properties: 'properties',
  tasks: 'tasks',
  groups: 'groups',
  clients: 'clients',
  settings: 'settings',
  probeCache: 'probe_cache',
  dashboardCache: 'dashboard_cache',
  savedFilters: 'saved_filters',
  semanticGroups: 'semantic_groups',
} as const;

let db: Firestore | undefined;

/** Shared Firestore client (lazy; uses ADC + project auto-detection). */
export function getFirestore(): Firestore {
  if (!db) {
    db = new Firestore({ ignoreUndefinedProperties: true });
  }
  return db;
}
