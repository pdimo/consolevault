import { describe, expect, it } from 'vitest';
import { signSession, verifySession } from './session.js';

const secret = 'test-secret';

describe('session', () => {
  it('round-trips a valid session', () => {
    const token = signSession({ email: 'a@b.com', exp: 2_000_000_000 }, secret);
    expect(verifySession(token, secret, 1_000)).toEqual({ email: 'a@b.com', exp: 2_000_000_000 });
  });

  it('rejects a tampered payload', () => {
    const token = signSession({ email: 'a@b.com', exp: 2_000_000_000 }, secret);
    const [, sig] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ email: 'evil@x.com', exp: 2_000_000_000 })).toString('base64url')}.${sig}`;
    expect(verifySession(forged, secret)).toBeNull();
  });

  it('rejects a wrong secret', () => {
    const token = signSession({ email: 'a@b.com', exp: 2_000_000_000 }, secret);
    expect(verifySession(token, 'other')).toBeNull();
  });

  it('rejects an expired session', () => {
    const token = signSession({ email: 'a@b.com', exp: 1_500 }, secret);
    expect(verifySession(token, secret, 2_000)).toBeNull();
  });
});
