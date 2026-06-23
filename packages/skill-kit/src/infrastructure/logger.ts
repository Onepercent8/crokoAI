/**
 * Structured, PII-free logger (SPEC-000 §11 Observabilidade, security.md).
 *
 * Logs carry a `run_id` for correlation with `agent_events`. Never log secrets
 * or PII. Output is one JSON object per line for machine ingestion.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  run_id: string;
  event: string;
  [key: string]: unknown;
}

/** A sink the logger writes serialized lines to (injectable for tests). */
export type LogSink = (line: string) => void;

/** Keys that must never appear in a log line (defense in depth). */
const FORBIDDEN_KEYS = new Set([
  'secret',
  'secret_key',
  'supabase_secret_key',
  'api_key',
  'apikey',
  'authorization',
  'token',
  'password',
  'email',
  'phone',
]);

function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = FORBIDDEN_KEYS.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return out;
}

/** Create a structured logger bound to a run_id. */
export function createLogger(
  runId: string,
  sink: LogSink = console.log,
): {
  log: (level: LogLevel, event: string, fields?: Record<string, unknown>) => void;
} {
  return {
    log(level, event, fields = {}) {
      const payload: LogFields & { level: LogLevel; ts: string } = {
        ts: new Date().toISOString(),
        level,
        run_id: runId,
        event,
        ...redact(fields),
      };
      sink(JSON.stringify(payload));
    },
  };
}
