/**
 * Authentication for the Google Search Console API.
 *
 * Two account kinds (SPEC §3):
 *  - OAuth accounts: a shared Desktop OAuth client + a per-account refresh token (both stored in
 *    Secret Manager). The local helper runs the loopback flow; runtime mints access tokens.
 *  - Service-account accounts: preferred via impersonation of a GSC-facing SA; downloaded keys
 *    only if unavoidable.
 *
 * Nothing here collects search data (CLAUDE.md hard rule 3) — auth + token health only.
 */

import { GoogleAuth, Impersonated, OAuth2Client } from 'google-auth-library';
import type { AuthClient } from 'google-auth-library';
import type { TokenHealth } from '@consolevault/types';

/** The single OAuth scope this product uses (SPEC §0). Read-only. */
export const WEBMASTERS_READONLY_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Desktop OAuth client credentials (from the downloaded client_secret JSON). */
export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

/** Parse the structure of a Google "Desktop app" client_secret_*.json file. */
export function parseClientSecretJson(json: unknown): OAuthClientConfig {
  const root = json as { installed?: Record<string, string>; web?: Record<string, string> };
  const node = root.installed ?? root.web;
  if (!node?.client_id || !node?.client_secret) {
    throw new Error('Invalid OAuth client JSON: expected an "installed" (Desktop) client.');
  }
  return { clientId: node.client_id, clientSecret: node.client_secret };
}

export function createOAuth2Client(config: OAuthClientConfig, redirectUri?: string): OAuth2Client {
  return new OAuth2Client({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    ...(redirectUri !== undefined ? { redirectUri } : {}),
  });
}

/** Consent URL that forces a refresh token (`access_type=offline&prompt=consent`). */
export function generateAuthUrl(
  client: OAuth2Client,
  scopes: string[] = [WEBMASTERS_READONLY_SCOPE],
): string {
  return client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: scopes });
}

export interface ExchangedTokens {
  refreshToken: string;
  accessToken?: string;
  expiryDate?: number;
}

/** Exchange a loopback auth code for tokens; requires a refresh token to be present. */
export async function exchangeCode(client: OAuth2Client, code: string): Promise<ExchangedTokens> {
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'No refresh token returned. Ensure the consent used prompt=consent and is a fresh grant.',
    );
  }
  return {
    refreshToken: tokens.refresh_token,
    ...(tokens.access_token ? { accessToken: tokens.access_token } : {}),
    ...(tokens.expiry_date ? { expiryDate: tokens.expiry_date } : {}),
  };
}

/** Authorized client for an OAuth account from its stored client config + refresh token. */
export function oauthClientFromRefreshToken(
  config: OAuthClientConfig,
  refreshToken: string,
): OAuth2Client {
  const client = createOAuth2Client(config);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

/**
 * Impersonated credentials for a service-account account (preferred over downloaded keys).
 * The running identity (e.g. sa-api) needs roles/iam.serviceAccountTokenCreator on the target.
 */
export async function serviceAccountClient(targetPrincipal: string): Promise<Impersonated> {
  const auth = new GoogleAuth();
  const sourceClient = await auth.getClient();
  return new Impersonated({
    sourceClient,
    targetPrincipal,
    targetScopes: [WEBMASTERS_READONLY_SCOPE],
    lifetime: 3600,
  });
}

/** Auth client from a downloaded service-account key (only when impersonation isn't possible). */
export async function serviceAccountClientFromKey(key: object): Promise<AuthClient> {
  const auth = new GoogleAuth({ credentials: key, scopes: [WEBMASTERS_READONLY_SCOPE] });
  return auth.getClient();
}

/** Pure classification of a token-refresh failure into a {@link TokenHealth} state. */
export function classifyTokenError(err: unknown): TokenHealth {
  const msg = String((err as { message?: unknown })?.message ?? err);
  if (/invalid_grant|token has been expired or revoked|revoked|account.*deleted/i.test(msg)) {
    return 'revoked';
  }
  return 'broken';
}

/** Probe an OAuth account's refresh token; returns its {@link TokenHealth}. */
export async function checkOAuthTokenHealth(
  config: OAuthClientConfig,
  refreshToken: string,
): Promise<TokenHealth> {
  try {
    const client = oauthClientFromRefreshToken(config, refreshToken);
    const { token } = await client.getAccessToken();
    return token ? 'valid' : 'broken';
  } catch (err) {
    return classifyTokenError(err);
  }
}
