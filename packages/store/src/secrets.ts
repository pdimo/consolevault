/**
 * Secret Manager helpers. Credentials live here ONLY (CLAUDE.md hard rule 1).
 *
 * Writers (the local helper) run as the deployer's ADC. Readers (Cloud Run SAs) have
 * secretAccessor. These helpers return Secret Manager **resource names** — never secret values
 * (except the explicit read in `getSecret`). Never log a returned value.
 */

import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

/** Canonical secret ids (SPEC §3 / plan §3). */
export const SECRET_IDS = {
  /** Desktop OAuth client (CLI helper, loopback flow). */
  oauthClientConfig: 'oauth-client-config',
  /** Web OAuth client (in-UI connect flow + Google Sign-In). */
  oauthWebClientConfig: 'oauth-web-client-config',
  oauthRefresh: (accountId: string): string => `oauth-refresh-${accountId}`,
  saKey: (accountId: string): string => `sa-key-${accountId}`,
} as const;

export class SecretStore {
  private readonly client: SecretManagerServiceClient;

  constructor(private readonly projectId: string) {
    this.client = new SecretManagerServiceClient();
  }

  private secretName(secretId: string): string {
    return `projects/${this.projectId}/secrets/${secretId}`;
  }

  private async ensureSecret(secretId: string): Promise<void> {
    try {
      await this.client.getSecret({ name: this.secretName(secretId) });
    } catch {
      await this.client.createSecret({
        parent: `projects/${this.projectId}`,
        secretId,
        secret: { replication: { automatic: {} } },
      });
    }
  }

  /** Create-if-missing then add a new version. Returns the secret resource name (NOT the value). */
  async putSecret(secretId: string, value: string): Promise<string> {
    await this.ensureSecret(secretId);
    await this.client.addSecretVersion({
      parent: this.secretName(secretId),
      payload: { data: Buffer.from(value, 'utf8') },
    });
    return this.secretName(secretId);
  }

  /** Read the latest version's value. Callers must never log this. */
  async getSecret(secretId: string): Promise<string> {
    const [version] = await this.client.accessSecretVersion({
      name: `${this.secretName(secretId)}/versions/latest`,
    });
    const data = version.payload?.data;
    if (data == null) {
      throw new Error(`Secret ${secretId} has no payload.`);
    }
    return Buffer.from(data as Uint8Array).toString('utf8');
  }
}
