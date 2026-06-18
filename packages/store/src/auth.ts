/**
 * Credential resolution: build an authorized GSC client for any account kind from its stored
 * credentials. Shared by the API (discovery) and the worker (collector) so there is one path.
 */

import type { AuthClient } from 'google-auth-library';
import {
  oauthClientFromRefreshToken,
  serviceAccountClient,
  serviceAccountClientFromKey,
  type OAuthClientConfig,
} from '@consolevault/gsc';
import type { Account } from '@consolevault/types';
import { SECRET_IDS, type SecretStore } from './secrets.js';

/** Authorized GSC client for an account: OAuth refresh token, SA key, or SA impersonation. */
export async function authClientForAccount(
  account: Account,
  secretStore: SecretStore,
): Promise<AuthClient> {
  if (account.type === 'oauth') {
    // Refresh with the client that minted the token (Desktop helper vs in-UI web flow).
    const clientSecretId = account.oauthClientSecretId ?? SECRET_IDS.oauthClientConfig;
    const config = JSON.parse(await secretStore.getSecret(clientSecretId)) as OAuthClientConfig;
    const refreshToken = await secretStore.getSecret(SECRET_IDS.oauthRefresh(account.id));
    return oauthClientFromRefreshToken(config, refreshToken);
  }
  if (account.secretRef) {
    const key = JSON.parse(await secretStore.getSecret(SECRET_IDS.saKey(account.id))) as object;
    return serviceAccountClientFromKey(key);
  }
  if (!account.email) {
    throw new Error('Service-account account is missing an email for impersonation.');
  }
  return serviceAccountClient(account.email);
}
