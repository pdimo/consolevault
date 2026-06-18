import { describe, expect, it } from 'vitest';
import { classifyRetryable, isRetryableError } from './errors.js';

describe('isRetryableError', () => {
  it('treats 429 and 5xx as retryable', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ response: { status: 503 } })).toBe(true);
    expect(isRetryableError({ code: 500 })).toBe(true);
  });

  it('treats quota/rateLimit reasons and messages as retryable', () => {
    expect(
      isRetryableError({
        response: { data: { error: { errors: [{ reason: 'rateLimitExceeded' }] } } },
      }),
    ).toBe(true);
    expect(isRetryableError(new Error('quotaExceeded'))).toBe(true);
  });

  it('treats 4xx (non-429) and unknown errors as non-retryable', () => {
    expect(isRetryableError({ status: 403 })).toBe(false);
    expect(isRetryableError(new Error('invalid argument'))).toBe(false);
  });
});

describe('classifyRetryable', () => {
  it('wraps with a retryable verdict and preserves the message', () => {
    const e = classifyRetryable(new Error('quotaExceeded'));
    expect(e.retryable).toBe(true);
    expect(e.message).toBe('quotaExceeded');
    const e2 = classifyRetryable({ status: 403, message: 'forbidden' });
    expect(e2.retryable).toBe(false);
  });
});
