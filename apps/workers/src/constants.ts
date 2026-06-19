/**
 * Dead-letter policy (SPEC §8): retry a failing task with exponential back-off up to maxAttempts,
 * then Cloud Tasks drops it and the collector leaves it terminal `error` (visible in Jobs, requeable).
 * Per-install via the TASK_MAX_ATTEMPTS env var.
 */
export const TASK_MAX_ATTEMPTS = Number(process.env.TASK_MAX_ATTEMPTS ?? 8);
