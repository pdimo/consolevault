/**
 * Pure coverage + grouping helpers (unit-tested) for the management UI (SPEC §8, §4, §10).
 */

import type { Property, Task, TaskStatus } from '@consolevault/types';

/** A heatmap cell's state: a task status, or 'not_planned' when no task exists for that day. */
export type CoverageState = TaskStatus | 'not_planned';

export function coverageState(task: Task | undefined): CoverageState {
  return task ? task.status : 'not_planned';
}

function hostOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Double-count risk (SPEC §4): a group containing a domain property AND a URL-prefix property on
 * the same domain (or a subdomain of it) would double-count when unioned.
 */
export function detectDoubleCount(
  properties: Pick<Property, 'siteUrl' | 'propertyType'>[],
): boolean {
  const domains = properties
    .filter((p) => p.propertyType === 'domain')
    .map((p) => p.siteUrl.replace(/^sc-domain:/, '').toLowerCase());
  if (domains.length === 0) return false;
  const hosts = properties
    .filter((p) => p.propertyType === 'url_prefix')
    .map((p) => hostOf(p.siteUrl));
  return hosts.some((host) => domains.some((d) => host === d || host.endsWith(`.${d}`)));
}
