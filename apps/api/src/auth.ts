/**
 * App-level Google Sign-In (single-admin). The api service is public-ingress but every /api route
 * (except the public ones) requires a signed session cookie issued only to configured admin emails.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { adminEmails, config, getWebClientConfig } from './deps.js';
import { signSession, verifySession, type Session } from './session.js';
import { HttpError } from './errors.js';

export const SESSION_COOKIE = 'cv_session';
const SESSION_TTL_SECONDS = 12 * 3600;

function sessionSecret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error('SESSION_SECRET is not set');
  return s;
}

/** Public paths that don't require a session. */
function isPublicPath(url: string): boolean {
  const path = url.split('?')[0] ?? url;
  if (!path.startsWith('/api/')) return true; // static assets + SPA
  return path === '/api/config' || path.startsWith('/api/auth/');
}

/** onRequest hook: enforce a valid admin session on protected /api routes. */
export function authHook(req: FastifyRequest, reply: FastifyReply, done: () => void): void {
  if (isPublicPath(req.url)) return done();
  const token = req.cookies?.[SESSION_COOKIE];
  const session = token ? verifySession(token, sessionSecret()) : null;
  if (!session) {
    void reply.code(401).send({ error: 'unauthorized' });
    return;
  }
  done();
}

export function registerAuthRoutes(app: FastifyInstance): void {
  // Public: the Web client id the Sign-In button needs (not secret) + the deployment's GSC-facing
  // service account (the email clients add to their Search Console for the service-account path).
  app.get('/api/config', async (req) => {
    let googleClientId: string | null = null;
    try {
      googleClientId = (await getWebClientConfig()).clientId || null;
    } catch {
      googleClientId = null; // Web client not provisioned yet → first-run setup wizard.
    }
    const host = req.hostname;
    return {
      googleClientId,
      needsSetup: !googleClientId,
      redirectUri: `https://${host}/api/oauth/callback`,
      jsOrigin: `https://${host}`,
      collectorServiceAccount: `sa-collector@${config.projectId}.iam.gserviceaccount.com`,
      // Service accounts a client must grant BigQuery Data Viewer to when sharing a native export
      // dataset (SPEC §12): the API reads it for connect/reports, the orchestrator for the daily job.
      exportReaderServiceAccounts: [
        `sa-api@${config.projectId}.iam.gserviceaccount.com`,
        `sa-workflows@${config.projectId}.iam.gserviceaccount.com`,
      ],
    };
  });

  app.post('/api/auth/google', async (req, reply) => {
    const { idToken } = (req.body ?? {}) as { idToken?: string };
    if (!idToken) throw new HttpError(400, 'idToken is required');
    const { clientId } = await getWebClientConfig();
    const ticket = await new OAuth2Client(clientId).verifyIdToken({ idToken, audience: clientId });
    const email = ticket.getPayload()?.email?.toLowerCase();
    if (!email || !adminEmails.includes(email)) {
      throw new HttpError(403, 'Not an authorized admin');
    }
    const session: Session = {
      email,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };
    reply.setCookie(SESSION_COOKIE, signSession(session, sessionSecret()), {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return { email };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // Public route (does its own cookie check) so the SPA can learn if it's signed in.
  app.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const session = token ? verifySession(token, sessionSecret()) : null;
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });
    return { email: session.email };
  });
}
