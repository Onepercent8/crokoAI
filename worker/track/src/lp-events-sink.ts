import type { LpEventRow } from './derive.js';
import type { FetchLike } from './destinations.js';
import type { LpEventsSink } from './ports.js';

/**
 * Supabase REST sink for `lp_events` (SPEC-015 §Contrato de escrita).
 *
 * Writes the NO-PII mirror via PostgREST + SUPABASE_SECRET_KEY (service_role),
 * never the Supabase MCP. `Prefer: resolution=ignore-duplicates` tolerates the
 * unique `event_id` so a re-delivery is a no-op (idempotency). The secret is
 * held in memory only and never logged. `lp_events` is append-only (INSERT only).
 */
export class SupabaseLpEventsSink implements LpEventsSink {
  constructor(private readonly cfg: { url: string; secretKey: string; fetchImpl: FetchLike }) {}

  async insert(row: LpEventRow): Promise<{ inserted: boolean }> {
    const base = this.cfg.url.replace(/\/+$/, '');
    const res = await this.cfg.fetchImpl(`${base}/rest/v1/lp_events`, {
      method: 'POST',
      headers: {
        apikey: this.cfg.secretKey,
        Authorization: `Bearer ${this.cfg.secretKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify([row]),
    });
    if (res.ok) {
      // 201 = inserted; 200 with ignore-duplicates = conflict ignored.
      return { inserted: res.status === 201 };
    }
    // Conflict is not an error with ignore-duplicates, but guard anyway.
    if (res.status === 409) {
      return { inserted: false };
    }
    throw new Error(`Failed to insert lp_events: PostgREST status ${res.status}`);
  }
}
