/**
 * Reconciliation planner (SPEC §8 — the correctness core).
 *
 * Backfill, daily increment, gap-fill, and look-back are the SAME operation: each run computes the
 * rolling window per cell (property × type × aggregation × day) and writes `pending` Task docs for
 * the days not already terminal (plus the look-back window). New and year-old properties run
 * identical logic, so steady-state can't drift from backfill.
 */

import { daysInRange, isValidCombo, windowFor } from '@consolevault/gsc';
import { PropertyRepository, TaskRepository, taskId } from '@consolevault/store';
import type { Task } from '@consolevault/types';

/**
 * Days to (re)collect: window days that aren't FINAL-terminal yet. `terminalDays` holds only days
 * locked as final (`collected_with_data`/`collected_no_data`). `collected_fresh` days are NOT in
 * the set, so they re-collect automatically each run until Google finalizes them (SPEC §8). Pure.
 */
export function computeMissingDays(allDays: string[], terminalDays: Set<string>): string[] {
  return allDays.filter((d) => !terminalDays.has(d));
}

/**
 * Reconcile included properties: write pending Task docs for missing cells.
 *
 * `propertyIds` scopes the sweep to just those properties — used when the admin tracks a
 * property and we collect it immediately rather than waiting for the daily run. Omit it for
 * the full daily sweep.
 */
export async function reconcile(
  propertyIds?: string[],
): Promise<{ properties: number; created: number }> {
  const propertyRepo = new PropertyRepository();
  const taskRepo = new TaskRepository();
  const scope = propertyIds?.length ? new Set(propertyIds) : null;
  // Native-export properties are read from their Bulk Export dataset via adapter views (SPEC §12) —
  // never collected via the API, so they never enter the planner.
  const properties = (await propertyRepo.list()).filter(
    (p) => p.included && p.source !== 'native_export' && (!scope || scope.has(p.id)),
  );

  const toCreate: Task[] = [];
  for (const property of properties) {
    const accountId = property.preferredAccountId ?? property.accountIds[0];
    if (!accountId) continue;

    const { config } = property;
    const { oldest, newest } = windowFor(config.offsetDays, config.backfillMonths);
    const allDays = daysInRange(oldest, newest);

    const existing = new Map((await taskRepo.listByProperty(property.id)).map((t) => [t.id, t]));
    const terminalByCell = new Map<string, Set<string>>();
    for (const t of existing.values()) {
      if (t.status === 'collected_with_data' || t.status === 'collected_no_data') {
        const key = `${t.searchType}|${t.aggregation}`;
        let set = terminalByCell.get(key);
        if (!set) {
          set = new Set();
          terminalByCell.set(key, set);
        }
        set.add(t.dataDate);
      }
    }

    for (const aggregation of config.aggregations) {
      for (const searchType of config.types) {
        // Skip API-unsupported cells (e.g. discover/googleNews × byProperty) — don't create doomed tasks.
        if (!isValidCombo(searchType, aggregation)) continue;
        const terminal = terminalByCell.get(`${searchType}|${aggregation}`) ?? new Set<string>();
        // `totals` derives the anonymized-query delta as total − sum(byProperty) for the same day
        // (SPEC §7.2). Only plan a totals day once its byProperty day is TERMINAL (so the rows are
        // in BigQuery) — otherwise the delta subtracts 0 and the whole day is flagged anonymized,
        // and once the day finalizes it never self-corrects (the Phase-D bug this fixes).
        const bpTerminal =
          aggregation === 'totals'
            ? (terminalByCell.get(`${searchType}|byProperty`) ?? new Set<string>())
            : null;
        const missing = computeMissingDays(allDays, terminal);
        for (const day of missing) {
          if (bpTerminal && !bpTerminal.has(day)) continue; // defer totals until byProperty[day] final
          const id = taskId(property.id, searchType, aggregation, day);
          const ex = existing.get(id);
          // Don't clobber an in-flight task (Cloud Tasks name dedup also protects double-runs).
          if (ex && (ex.status === 'pending' || ex.status === 'queued')) continue;
          toCreate.push({
            id,
            propertyId: property.id,
            searchType,
            aggregation,
            dataDate: day,
            status: 'pending',
            attempts: 0,
            accountId,
          });
        }
      }
    }
  }
  const created = await taskRepo.createMany(toCreate);
  return { properties: properties.length, created };
}
