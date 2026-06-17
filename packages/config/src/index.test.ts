import { describe, expect, it } from 'vitest';
import { loadConfig, MissingConfigError } from './index.js';

describe('loadConfig', () => {
  const base = {
    GCP_PROJECT_ID: 'your-gcp-project-id',
    GCP_REGION: 'us-central1',
    BQ_LOCATION: 'US',
  } satisfies NodeJS.ProcessEnv;

  it('loads required values and defaults appName', () => {
    const cfg = loadConfig({ ...base });
    expect(cfg.projectId).toBe('your-gcp-project-id');
    expect(cfg.region).toBe('us-central1');
    expect(cfg.bqLocation).toBe('US');
    expect(cfg.appName).toBe('consolevault');
    expect(cfg.stagingBucket).toBeUndefined();
  });

  it('reads optional overrides', () => {
    const cfg = loadConfig({ ...base, APP_NAME: 'cv', STAGING_BUCKET: 'cv-staging' });
    expect(cfg.appName).toBe('cv');
    expect(cfg.stagingBucket).toBe('cv-staging');
  });

  it('throws MissingConfigError when a required var is absent', () => {
    expect(() => loadConfig({ GCP_REGION: 'us-central1', BQ_LOCATION: 'US' })).toThrow(
      MissingConfigError,
    );
  });
});
