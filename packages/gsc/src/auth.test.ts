import { describe, expect, it } from 'vitest';
import { classifyTokenError, parseClientSecretJson } from './auth.js';

describe('classifyTokenError', () => {
  it('maps invalid_grant / revoked to revoked', () => {
    expect(classifyTokenError(new Error('invalid_grant: Token has been expired or revoked.'))).toBe(
      'revoked',
    );
    expect(classifyTokenError({ message: 'The token has been revoked.' })).toBe('revoked');
  });

  it('maps other failures to broken', () => {
    expect(classifyTokenError(new Error('network ECONNRESET'))).toBe('broken');
    expect(classifyTokenError('something else')).toBe('broken');
  });
});

describe('parseClientSecretJson', () => {
  it('reads an installed (Desktop) client', () => {
    expect(
      parseClientSecretJson({ installed: { client_id: 'cid', client_secret: 'sec' } }),
    ).toEqual({ clientId: 'cid', clientSecret: 'sec' });
  });

  it('falls back to a web client block', () => {
    expect(parseClientSecretJson({ web: { client_id: 'w', client_secret: 's' } })).toEqual({
      clientId: 'w',
      clientSecret: 's',
    });
  });

  it('throws on a malformed client JSON', () => {
    expect(() => parseClientSecretJson({ nope: true })).toThrow(/Invalid OAuth client JSON/);
  });
});
