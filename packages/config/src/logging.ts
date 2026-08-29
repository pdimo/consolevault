/**
 * Cloud Logging severity for pino.
 *
 * Cloud Run parses a JSON line on stdout into `jsonPayload` and lifts a few reserved keys out of
 * it — `severity` is one. Pino writes its own `level` number instead and never writes `severity`,
 * so every line an app logs (including `logger.error`) lands as severity DEFAULT. Anything that
 * selects on severity therefore matches nothing: the `severity>=ERROR` log-based metric behind the
 * "collector error spike" alert (terraform/monitoring.tf) counted zero for the life of the
 * deployment while real `level: 50` lines were being written.
 *
 * Emitting `severity` alongside `level` fixes the metric and colours the Logs Explorer. `level` is
 * kept so existing `jsonPayload.level` queries still work.
 */

/** pino level label → Cloud Logging LogSeverity. */
const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * pino options for a service on Cloud Run — pass as Fastify's `logger` in place of `true`.
 */
export const cloudLoggingOptions = {
  formatters: {
    level(label: string, number: number) {
      return { severity: SEVERITY[label] ?? 'DEFAULT', level: number };
    },
  },
};
