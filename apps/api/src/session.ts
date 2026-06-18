/**
 * Signed session token (HMAC-SHA256). The single-admin session after Google Sign-In.
 * Format: `<base64url(payload)>.<base64url(hmac)>`. Pure; unit-tested.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface Session {
  email: string;
  /** Unix seconds expiry. */
  exp: number;
}

export function signSession(session: Session, secret: string): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token: string, secret: string, nowSeconds?: number): Session | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session;
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    if (typeof session.exp !== 'number' || session.exp < now) return null;
    return session;
  } catch {
    return null;
  }
}
