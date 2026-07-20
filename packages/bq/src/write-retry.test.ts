/**
 * Retry behaviour for the delete-then-load slice write (SPEC §9). The 2026-06-19/20 backfill
 * failed 393 slices on transient per-table DML concurrency/rate ceilings; these tests pin the
 * classifier and the bounded, jittered backoff that turns those rejections into eventual success.
 */

import { describe, expect, it, vi } from 'vitest';
import { isRetriableBqError, withBqRetry } from './write.js';

const noSleep = () => Promise.resolve();

describe('isRetriableBqError', () => {
  it('matches the DML "pending + running" quota error by message text', () => {
    expect(
      isRetriableBqError({
        message:
          'Quota exceeded: Your table exceeded quota for total number of dml jobs writing to a table, pending + running.',
      }),
    ).toBe(true);
  });

  it('matches the DML insert rate-limit error by message text', () => {
    expect(
      isRetriableBqError({
        message:
          'Job exceeded rate limits: Your table exceeded quota for table dml insert operations.',
      }),
    ).toBe(true);
  });

  it('matches structured retriable reasons', () => {
    expect(isRetriableBqError({ errors: [{ reason: 'rateLimitExceeded' }] })).toBe(true);
    expect(isRetriableBqError({ errors: [{ reason: 'quotaExceeded' }] })).toBe(true);
    expect(isRetriableBqError({ code: 503 })).toBe(true);
  });

  it('does not retry genuine non-transient failures', () => {
    expect(isRetriableBqError({ code: 404, message: 'Not found: Table x' })).toBe(false);
    expect(isRetriableBqError({ errors: [{ reason: 'invalidQuery' }] })).toBe(false);
    expect(isRetriableBqError(new Error('boom'))).toBe(false);
  });
});

describe('withBqRetry', () => {
  it('returns immediately on first success', async () => {
    const op = vi.fn().mockResolvedValue('ok');
    await expect(withBqRetry(op, { sleep: noSleep })).resolves.toBe('ok');
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('retries a transient rate-limit error then succeeds', async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce({ errors: [{ reason: 'rateLimitExceeded' }] })
      .mockRejectedValueOnce({ message: 'exceeded quota for total number of dml jobs' })
      .mockResolvedValue('loaded');
    await expect(withBqRetry(op, { sleep: noSleep, random: () => 0 })).resolves.toBe('loaded');
    expect(op).toHaveBeenCalledTimes(3);
  });

  it('rethrows non-retriable errors without retrying', async () => {
    const err = { code: 404, message: 'Not found' };
    const op = vi.fn().mockRejectedValue(err);
    await expect(withBqRetry(op, { sleep: noSleep })).rejects.toBe(err);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('gives up after maxAttempts and rethrows the last error', async () => {
    const err = { errors: [{ reason: 'rateLimitExceeded' }] };
    const op = vi.fn().mockRejectedValue(err);
    await expect(withBqRetry(op, { maxAttempts: 4, sleep: noSleep, random: () => 0 })).rejects.toBe(
      err,
    );
    expect(op).toHaveBeenCalledTimes(4);
  });

  it('backs off with exponential full jitter, capped at maxDelayMs', async () => {
    const delays: number[] = [];
    const sleep = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };
    const op = vi.fn().mockRejectedValue({ errors: [{ reason: 'rateLimitExceeded' }] });
    await expect(
      withBqRetry(op, {
        maxAttempts: 5,
        baseDelayMs: 1000,
        maxDelayMs: 4000,
        random: () => 0.999999, // near the full-jitter upper bound → observe the caps directly
        sleep,
      }),
    ).rejects.toBeDefined();
    // exponential caps 1000 → 2000 → 4000(capped) → 4000(capped), scaled by the jitter fraction
    expect(delays).toEqual([999, 1999, 3999, 3999]);
  });
});
