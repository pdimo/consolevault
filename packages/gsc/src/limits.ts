/**
 * Google Search Console API usage limits for the Search Analytics resource, and ConsoleVault's own
 * per-account dispatch ceiling. Source of truth for the Quota/capacity dashboard (Stage 6).
 * https://developers.google.com/webmaster-tools/limits (verified 2026-06).
 *
 * Note: batched calls count as N queries (not 1), so batching gives no quota relief — efficiency
 * comes from fewer/smaller requests, not batching.
 */
export const GSC_LIMITS = {
  perUserQpm: 1_200,
  perSiteQpm: 1_200,
  perProjectQpm: 40_000,
  perProjectQpd: 30_000_000,
  source: 'https://developers.google.com/webmaster-tools/limits',
} as const;

/** Cloud Tasks dispatch ceiling per account queue — kept well under the 1,200 QPM per-user cap. */
export const DISPATCH_PER_SECOND_PER_ACCOUNT = 10;
export const DISPATCH_QPM_PER_ACCOUNT = DISPATCH_PER_SECOND_PER_ACCOUNT * 60; // 600

/**
 * Capacity estimate for the Quota dashboard (pure; unit-tested). The per-project daily quota
 * (30M QPD) is the only hard *volume* cap, so headroom against it gives an honest "how many more
 * properties can I add" figure. avg calls/property comes from today's measured usage.
 */
export function capacityEstimate(
  todayCalls: number,
  activeProperties: number,
): { avgCallsPerProperty: number; projectQpdUsedPct: number; estMoreProperties: number | null } {
  const active = Math.max(1, activeProperties);
  const avg = todayCalls / active;
  const usedPct = (todayCalls / GSC_LIMITS.perProjectQpd) * 100;
  const headroom = Math.max(0, GSC_LIMITS.perProjectQpd - todayCalls);
  return {
    avgCallsPerProperty: Number(avg.toFixed(2)),
    projectQpdUsedPct: Number(usedPct.toFixed(4)),
    estMoreProperties: avg > 0 ? Math.floor(headroom / avg) : null,
  };
}
