/**
 * Pure discovery helpers (CLAUDE.md: unit-test pure logic first).
 *
 * The persistence side (computing sanitizedTableName, merging accountIds, writing Firestore)
 * lives in `@consolevault/store` so this package stays a thin GSC wrapper.
 */

import type { PropertyType } from '@consolevault/types';

/** Domain (`sc-domain:…`) vs URL-prefix property (SPEC §4). */
export function derivePropertyType(siteUrl: string): PropertyType {
  return siteUrl.startsWith('sc-domain:') ? 'domain' : 'url_prefix';
}
