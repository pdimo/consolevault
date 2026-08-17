/**
 * Credential resolution: build an authorized GSC client for any account kind from its stored
 * credentials. Shared by the API (discovery) and the worker (collector) so there is one path.
 */

import type { AuthClient } from 'google-auth-library';
import {
  oauthClientFromRefreshToken,
  parseClientSecretJson,
  serviceAccountClient,
  serviceAccountClientFromKey,
} from '@consolevault/gsc';
import type { Account } from '@consolevault/types';
import { SECRET_IDS, type SecretStore } from './secrets.js';

/** Authorized GSC client for an account: OAuth refresh token, SA key, or SA impersonation. */
export async function authClientForAccount(
  account: Account,
  secretStore: SecretStore,
): Promise<AuthClient> {
  // BigQuery-export connections (SPEC §12) are not GSC-API accounts — they have no OAuth/SA
  // credentials. Callers must skip them; this guard makes a stray call fail clearly.
  if (account.type === 'bigquery_export') {
    throw new Error('BigQuery-export connections have no GSC credentials (read-only import).');
  }
  if (account.type === 'oauth') {
    // Refresh with the client that minted the token (Desktop helper vs in-UI web flow).
    const clientSecretId = account.oauthClientSecretId ?? SECRET_IDS.oauthClientConfig;
    // The stored secret is the raw downloaded Google client file ({web:{…}} for the in-UI web flow,
    // {installed:{…}} for the Desktop helper). parseClientSecretJson pulls client_id/client_secret
    // out of that nesting — a blind cast to {clientId,clientSecret} leaves them undefined and the
    // token refresh fails with invalid_request.
    const config = parseClientSecretJson(JSON.parse(await secretStore.getSecret(clientSecretId)));
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
