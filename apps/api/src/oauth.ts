/**
 * In-UI "Connect Google account" — server-side web OAuth (SPEC §10, [[stage4-onboarding-ux]]).
 * Replaces the CLI helper for the common case; writes the refresh token straight to Secret Manager.
 */

import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { WEBMASTERS_READONLY_SCOPE } from '@consolevault/gsc';
import { discoverAccount, SECRET_IDS } from '@consolevault/store';
import type { Account } from '@consolevault/types';
import { accountRepo, clearWebClientCache, getWebClientConfig, secretStore } from './deps.js';
import { signSession, verifySession } from './session.js';
import { HttpError } from './errors.js';

const SCOPES = ['openid', 'email', WEBMASTERS_READONLY_SCOPE];

function stateSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

function redirectUri(req: FastifyRequest): string {
  return `https://${req.hostname}/api/oauth/callback`;
}

export function registerOAuthRoutes(app: FastifyInstance): void {
  // Upload/replace the Web OAuth client JSON (admin) → enables Google Sign-In + Connect on any
  // deployment, including the bootstrap path which doesn't configure one at install time.
  app.post('/api/oauth/client', async (req) => {
    const { clientJson } = (req.body ?? {}) as { clientJson?: string };
    if (!clientJson) throw new HttpError(400, 'clientJson is required');
    let node: { client_id?: string; client_secret?: string } | undefined;
    try {
      const parsed = JSON.parse(clientJson) as {
        web?: { client_id?: string; client_secret?: string };
        installed?: { client_id?: string; client_secret?: string };
        client_id?: string;
        client_secret?: string;
      };
      node = parsed.web ?? parsed.installed ?? parsed;
    } catch {
      throw new HttpError(400, 'That is not valid JSON — paste the whole file you downloaded.');
    }
    if (!node?.client_id || !node?.client_secret) {
      throw new HttpError(
        400,
        'The JSON needs a client_id and client_secret. Create a "Web application" OAuth client in the Console and download its JSON.',
      );
    }
    await secretStore.putSecret(SECRET_IDS.oauthWebClientConfig, clientJson);
    clearWebClientCache();
    return { ok: true };
  });

  app.get('/api/oauth/start', async (req) => {
    const cfg = await getWebClientConfig().catch(() => null);
    if (!cfg?.clientId) {
      throw new HttpError(409, 'Google Sign-In isn’t set up yet — add a Web OAuth client first.');
    }
    const client = new OAuth2Client({
      clientId: cfg.clientId,
      clientSecret: cfg.clientSecret,
      redirectUri: redirectUri(req),
    });
    const state = signSession(
      { email: 'oauth-connect', exp: Math.floor(Date.now() / 1000) + 600 },
      stateSecret(),
    );
    const url = client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES,
      state,
    });
    return { url };
  });

  app.get('/api/oauth/callback', async (req, reply) => {
    const { code, state, error } = req.query as {
      code?: string;
      state?: string;
      error?: string;
    };
    if (error) return reply.redirect('/accounts?connect=denied');
    if (!code || !state || !verifySession(state, stateSecret())) {
      throw new HttpError(400, 'Invalid or expired OAuth state');
    }
    const { clientId, clientSecret } = await getWebClientConfig();
    const client = new OAuth2Client({ clientId, clientSecret, redirectUri: redirectUri(req) });
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      throw new HttpError(400, 'No refresh token returned; re-consent required.');
    }

    let email: string | undefined;
    if (tokens.id_token) {
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: clientId });
      email = ticket.getPayload()?.email ?? undefined;
    }

    const accountId = randomUUID();
    const secretRef = await secretStore.putSecret(
      SECRET_IDS.oauthRefresh(accountId),
      tokens.refresh_token,
    );
    const account: Account = {
      id: accountId,
      type: 'oauth',
      displayName: email ?? `oauth-${accountId.slice(0, 8)}`,
      secretRef,
      oauthClientSecretId: SECRET_IDS.oauthWebClientConfig,
      tokenHealth: 'valid',
      createdAt: new Date().toISOString(),
      ...(email ? { email } : {}),
    };
    await accountRepo.create(account);
    // Run discovery immediately so the account's properties show up without a manual step.
    try {
      await discoverAccount(accountId, secretStore);
    } catch {
      // Non-fatal: the account is connected; the Discover button can retry.
    }
    return reply.redirect('/accounts?connect=success');
  });
}
