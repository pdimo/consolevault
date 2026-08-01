/**
 * Shared 12-factor config loader (CLAUDE.md conventions).
 *
 * Config comes from the environment; secrets come from Secret Manager (never from env files
 * committed to the repo). This module only reads non-secret runtime configuration.
 */

export interface AppConfig {
  /** GCP project id. */
  projectId: string;
  /** Cloud Run / Tasks / Workflows region (e.g. `us-central1`). */
  region: string;
  /** Permanent BigQuery + Firestore location (e.g. `US`). */
  bqLocation: string;
  /** Logical app name / resource prefix (e.g. `consolevault`). */
  appName: string;
  /** Optional GCS staging bucket for NDJSON load jobs. */
  stagingBucket?: string;
}

/** Thrown when a required environment variable is missing or empty. */
export class MissingConfigError extends Error {
  constructor(readonly key: string) {
    super(`Missing required environment variable: ${key}`);
    this.name = 'MissingConfigError';
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value === '') {
    throw new MissingConfigError(key);
  }
  return value;
}

function optional(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Cloud Tasks queue id for an account (one queue per account, SPEC §5.3). Shared by the enqueue
 * worker (which creates it) and the API (which deletes it on account removal) so both agree on the
 * name. Capped at Cloud Tasks' 100-char queue-id limit.
 */
export function accountQueueId(accountId: string): string {
  return `cv-acct-${accountId}`.slice(0, 100);
}

/**
 * Load and validate {@link AppConfig} from the given environment (defaults to `process.env`).
 * Throws {@link MissingConfigError} if a required variable is absent.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const stagingBucket = optional(env, 'STAGING_BUCKET');
  return {
    projectId: required(env, 'GCP_PROJECT_ID'),
    region: required(env, 'GCP_REGION'),
    bqLocation: required(env, 'BQ_LOCATION'),
    appName: optional(env, 'APP_NAME') ?? 'consolevault',
    ...(stagingBucket !== undefined ? { stagingBucket } : {}),
  };
}
