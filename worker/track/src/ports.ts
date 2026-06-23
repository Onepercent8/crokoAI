import type { HashedUserData, LpEventRow } from './derive.js';
import type { TrackEvent } from './schema.js';

/**
 * Injectable ports for the tracking handler (SPEC-015). All external boundaries
 * (edge state, Supabase REST, marketing destinations) sit behind interfaces so
 * the handler is pure logic and fully testable offline with mocks. Production
 * wires D1 / fetch adapters in `index.ts`.
 */

/** Edge state for rate limiting + event_id dedup (D1/KV in prod). */
export interface EdgeStore {
  /**
   * Increment the counter for `key` within the current minute window and return
   * the new count. Implementations expire the window after ~60s.
   */
  incrementRateCounter(key: string, windowSeconds: number): Promise<number>;

  /** True if `eventId` was already seen (best-effort edge dedup). */
  hasEvent(eventId: string): Promise<boolean>;

  /** Mark `eventId` as seen. */
  markEvent(eventId: string): Promise<void>;
}

/** Writes the NO-PII mirror row to Supabase `lp_events`. */
export interface LpEventsSink {
  /**
   * Insert the row. Tolerates duplicate `event_id` (unique) without error —
   * returns `{ inserted: false }` on conflict so the handler stays idempotent.
   */
  insert(row: LpEventRow): Promise<{ inserted: boolean }>;
}

/** Context passed to each marketing destination for server-side fan-out. */
export interface FanoutContext {
  event: TrackEvent;
  hashed: HashedUserData;
  country: string | undefined;
}

/** One marketing destination (CAPI / GA4 / Google Ads). */
export interface Destination {
  readonly name: string;
  send(ctx: FanoutContext): Promise<void>;
}

/** Structured, NO-PII logger. */
export interface Logger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
