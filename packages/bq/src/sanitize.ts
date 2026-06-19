import { createHash } from 'node:crypto';

/**
 * Deterministic BigQuery-safe table name from a GSC property URL (SPEC §6.1).
 *
 * Used both as the BigQuery table name (Stage 2) and as the Firestore property document id
 * (so re-discovery upserts the same doc instead of duplicating). Type-prefixed so a domain
 * property and a same-host url-prefix property never collide.
 *
 * Exotic collisions (e.g. `/a-b` and `/a_b` both sanitizing to `..._a_b`, or IDN/punycode
 * variants) are resolved at discovery time by {@link disambiguatedTableName} — see
 * `PropertyRepository.upsertFromDiscovery`. This function stays pure + stable.
 */
export function sanitizeTableName(siteUrl: string): string {
  const isDomain = siteUrl.startsWith('sc-domain:');
  const raw = isDomain ? siteUrl.slice('sc-domain:'.length) : siteUrl.replace(/^https?:\/\//i, '');
  const body = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_') // collapse any non-alphanumeric run to a single underscore
    .replace(/^_+|_+$/g, ''); // trim leading/trailing underscores
  const prefix = isDomain ? 'domain' : 'urlp';
  // BigQuery table names allow up to 1024 chars; keep well under.
  return `${prefix}_${body}`.slice(0, 1024);
}

/**
 * A collision-disambiguated table name: the base name plus a short, stable hash of the FULL
 * siteUrl. Deterministic per siteUrl, so a given property always resolves to the same name even
 * when it collides with a different siteUrl that shares the base. Pure.
 */
export function disambiguatedTableName(siteUrl: string): string {
  const base = sanitizeTableName(siteUrl);
  const hash = createHash('sha256').update(siteUrl).digest('hex').slice(0, 8);
  return `${base}_${hash}`.slice(0, 1024);
}
