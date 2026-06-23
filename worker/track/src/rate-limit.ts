import { sha256Hex } from './derive.js';
import type { EdgeStore } from './ports.js';

/**
 * Rate limit by client IP (SPEC-015 §Comportamento, step 3).
 *
 * The IP is hashed (SHA-256) before use as a counter key — the raw IP is never
 * persisted (NO-PII; .claude/rules/security.md). Counting is delegated to the
 * injected EdgeStore (D1/KV) within a 60s window. Pure aside from the digest.
 */

const WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds the client should wait before retrying (for `Retry-After`). */
  retryAfter: number;
}

/** Derive the rate-limit key from the IP (hashed, never stored raw). */
export async function rateLimitKey(ip: string): Promise<string> {
  return `rl:${await sha256Hex(ip)}`;
}

/**
 * Check + record one request against the limit. Returns whether it is allowed.
 * `limitPerMinute` requests are allowed per window; the (limit+1)th is rejected.
 */
export async function checkRateLimit(
  store: EdgeStore,
  ip: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  const key = await rateLimitKey(ip);
  const count = await store.incrementRateCounter(key, WINDOW_SECONDS);
  if (count > limitPerMinute) {
    return { allowed: false, retryAfter: WINDOW_SECONDS };
  }
  return { allowed: true, retryAfter: 0 };
}
