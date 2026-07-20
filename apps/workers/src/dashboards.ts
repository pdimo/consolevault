/**
 * Daily dashboard precompute ("Morning Paper"). Warms the Firestore result cache for every enabled
 * dashboard's DEFAULT view (28d / daily / web, no filters) so the first load each day is instant at
 * $0 BigQuery cost. Runs as a daily-workflow step (sa-workflows). byProperty-only reports — no extra
 * IAM beyond what materialized views already granted.
 */

import { loadConfig } from '@consolevault/config';
import { Warehouse } from '@consolevault/bq';
import {
  cacheKey,
  canonicalQs,
  DashboardCache,
  DashboardService,
  GroupRepository,
  PRECOMPUTE_REPORTS,
  PropertyRepository,
} from '@consolevault/store';

const config = loadConfig();
const warehouse = new Warehouse({
  projectId: config.projectId,
  location: config.bqLocation,
  stagingBucket: config.stagingBucket ?? '',
});
const propertyRepo = new PropertyRepository();
const groupRepo = new GroupRepository();
const service = new DashboardService(warehouse, config.projectId);
const cache = new DashboardCache();

const DAY_TTL = 25 * 60 * 60 * 1000;
const DEFAULT_Q = { range: '28d', rollup: 'day', searchType: 'web' };

export async function refreshDashboards(): Promise<{ targets: number; warmed: number }> {
  const [properties, groups] = await Promise.all([propertyRepo.list(), groupRepo.list()]);
  const targets = [
    ...properties.filter((p) => p.dashboardEnabled).map((p) => ({ type: 'property', id: p.id })),
    ...groups.filter((g) => g.dashboardEnabled).map((g) => ({ type: 'group', id: g.id })),
  ];
  let warmed = 0;
  for (const t of targets) {
    for (const report of PRECOMPUTE_REPORTS) {
      const variants = report === 'breakdown' ? [{ dim: 'device' }, { dim: 'country' }] : [{}];
      for (const v of variants) {
        const q = { ...DEFAULT_Q, ...v };
        const key = cacheKey(
          t.type,
          t.id,
          report + ('dim' in v ? `:${v.dim}` : ''),
          canonicalQs(q),
        );
        try {
          const data = await service.report(report, t.type, t.id, q);
          await cache.set(key, data, DAY_TTL);
          warmed++;
        } catch {
          // skip a failing report; the API will warm it on first request
        }
      }
    }
  }
  return { targets: targets.length, warmed };
}
