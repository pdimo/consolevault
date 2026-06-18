/** Firestore singleton for global defaults applied to new properties (SPEC §10). */

import type { Firestore } from '@google-cloud/firestore';
import type { Settings } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';

const DOC_ID = 'global';

export const DEFAULT_SETTINGS: Settings = {
  defaultOffsetDays: 2,
  defaultBackfillMonths: 16,
  defaultTypes: ['web'],
  defaultAggregations: ['byProperty'],
};

export class SettingsRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  async get(): Promise<Settings> {
    const doc = await this.db.collection(COLLECTIONS.settings).doc(DOC_ID).get();
    return doc.exists ? (doc.data() as Settings) : DEFAULT_SETTINGS;
  }

  async put(settings: Settings): Promise<void> {
    await this.db.collection(COLLECTIONS.settings).doc(DOC_ID).set(settings);
  }
}
