import type { EdgeStore } from './ports.js';

/**
 * D1-backed EdgeStore (SPEC-015): event_id dedup + per-IP rate counters.
 *
 * Best-effort, eventually consistent edge state. The definitive idempotency
 * guarantee remains the unique `event_id` in `lp_events`. Raw IPs are never
 * stored — only the hashed rate-limit key produced by `rate-limit.ts`.
 *
 * Expected schema (see migrations/0001_init.sql):
 *   seen_events(event_id TEXT PRIMARY KEY, seen_at INTEGER)
 *   rate_counters(key TEXT, window_start INTEGER, count INTEGER, PRIMARY KEY(key, window_start))
 */
export class D1EdgeStore implements EdgeStore {
  constructor(private readonly db: D1Database) {}

  async incrementRateCounter(key: string, windowSeconds: number): Promise<number> {
    const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
    await this.db
      .prepare(
        `INSERT INTO rate_counters (key, window_start, count) VALUES (?, ?, 1)
         ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1`,
      )
      .bind(key, windowStart)
      .run();
    const row = await this.db
      .prepare(`SELECT count FROM rate_counters WHERE key = ? AND window_start = ?`)
      .bind(key, windowStart)
      .first<{ count: number }>();
    return row?.count ?? 1;
  }

  async hasEvent(eventId: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 AS hit FROM seen_events WHERE event_id = ?`)
      .bind(eventId)
      .first<{ hit: number }>();
    return row !== null;
  }

  async markEvent(eventId: string): Promise<void> {
    await this.db
      .prepare(`INSERT OR IGNORE INTO seen_events (event_id, seen_at) VALUES (?, ?)`)
      .bind(eventId, Math.floor(Date.now() / 1000))
      .run();
  }
}
