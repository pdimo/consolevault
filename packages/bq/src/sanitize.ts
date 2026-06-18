/**
 * Deterministic BigQuery-safe table name from a GSC property URL (SPEC §6.1).
 *
 * Used both as the BigQuery table name (Stage 2) and as the Firestore property document id
 * (so re-discovery upserts the same doc instead of duplicating). Type-prefixed so a domain
 * property and a same-host url-prefix property never collide.
 *
 * SPEC §14 open item: exotic collision cases (e.g. paths that sanitize to the same string) and
 * IDN/punycode normalization are a documented follow-up; the type prefix + host + path covers
 * the realistic cases.
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
