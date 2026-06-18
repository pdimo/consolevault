/**
 * `@consolevault/store` — control-plane persistence: Firestore repositories (accounts,
 * properties) + Secret Manager helpers. Used by `apps/api` now and the discover worker (Stage 3).
 */

export * from './firestore.js';
export * from './secrets.js';
export * from './accounts.js';
export * from './properties.js';
export * from './tasks.js';
export * from './auth.js';
export * from './discovery.js';
export * from './coverage.js';
export * from './groups.js';
export * from './settings.js';
