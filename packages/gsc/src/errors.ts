/**
 * Classify GSC API failures so the collector knows whether to retry.
 *
 * Retryable (transient) → throw so Cloud Tasks backs off (Stage 3) / the manual caller can retry.
 * Non-retryable → the task should go terminal `error` rather than loop forever.
 */

interface GaxiosLikeError {
  code?: number | string;
  status?: number;
  response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } };
  message?: string;
}

/** True for quota / rate-limit / transient 5xx failures that warrant a retry. */
export function isRetryableError(err: unknown): boolean {
  const e = err as GaxiosLikeError;
  const status = Number(e?.status ?? e?.response?.status ?? e?.code);
  if (status === 429 || (status >= 500 && status <= 599)) return true;

  const reasons = e?.response?.data?.error?.errors?.map((x) => x.reason ?? '') ?? [];
  if (reasons.some((r) => /quota|rateLimit|backendError|internalError/i.test(r))) return true;

  const msg = String(e?.message ?? '');
  return /quotaExceeded|rateLimitExceeded|userRateLimitExceeded|backendError|try again/i.test(msg);
}

/** Error carrying whether the caller should retry. */
export class CollectionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CollectionError';
  }
}

/** Wrap an unknown failure as a {@link CollectionError} with a retryable verdict. */
export function classifyRetryable(err: unknown): CollectionError {
  const retryable = isRetryableError(err);
  const message = err instanceof Error ? err.message : String(err);
  return new CollectionError(message, retryable, err);
}
