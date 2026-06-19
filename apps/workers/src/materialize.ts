/**
 * Refresh materialized property-group tables (opt-in, SPEC §6.4 / Stage 6). For each group flagged
 * `materialized`, rebuild `gsc_views.group_<id>_mat` as a CREATE OR REPLACE TABLE snapshot of the
 * group's union over its collected members. Runs as a daily-workflow step (sa-workflows). The
 * snapshot lags by up to one collection cycle — fine for BI; the live union VIEW is always current.
 */

import { loadConfig } from '@consolevault/config';
import { buildUnionViewSql, DATASETS, Warehouse } from '@consolevault/bq';
import { GroupRepository, PropertyRepository } from '@consolevault/store';

const config = loadConfig();
const warehouse = new Warehouse({
  projectId: config.projectId,
  location: config.bqLocation,
  stagingBucket: config.stagingBucket ?? '',
});
const groupRepo = new GroupRepository();
const propertyRepo = new PropertyRepository();

function matTableId(groupId: string): string {
  return `group_${groupId.replace(/[^a-zA-Z0-9]/g, '_')}_mat`;
}

export async function refreshMaterialized(): Promise<{ refreshed: string[] }> {
  const groups = (await groupRepo.list()).filter((g) => g.materialized);
  const refreshed: string[] = [];
  for (const group of groups) {
    const members = (
      await Promise.all(group.memberPropertyIds.map((id) => propertyRepo.get(id)))
    ).filter((p): p is NonNullable<typeof p> => Boolean(p));
    const existing: string[] = [];
    for (const m of members) {
      if (await warehouse.tableExists(DATASETS.byProperty, m.sanitizedTableName)) {
        existing.push(m.sanitizedTableName);
      }
    }
    const matId = matTableId(group.id);
    if (existing.length > 0) {
      await warehouse.createOrReplaceTable(matId, buildUnionViewSql(config.projectId, existing));
      refreshed.push(matId);
    } else {
      await warehouse.dropTableIfExists(matId);
    }
  }
  return { refreshed };
}
