import type { PendingAction, SkillSlug, Kind } from './schemas';

/**
 * Two-turn confirmation tokens (SPEC-016 §"Confirmação em dois turnos").
 *
 * A write action proposed in the first chat turn produces a `pending_action`
 * with a single-use `action_id` scoped to `(session_id, slug, args)` and a short
 * expiry. The mutation (enqueue into `agent_jobs`) only happens on a SEPARATE
 * `POST /api/nexus/confirm` carrying the exact `action_id`. There is no
 * "confirm=true" free-text path. Reusing or expiring an `action_id` fails.
 *
 * The store is an injectable interface so the route uses a process/edge-safe
 * implementation while tests use an in-memory fake (no I/O in unit tests).
 */

/** Default lifetime of a pending action (seconds). */
export const PENDING_ACTION_TTL_SECONDS = 120;

export interface PendingActionRecord {
  action_id: string;
  session_id: string;
  slug: SkillSlug;
  kind: Kind;
  client_id: string;
  args: Record<string, unknown>;
  expires_at_ms: number;
  consumed: boolean;
}

/** Outcome of attempting to consume an action_id. */
export type ConsumeResult =
  | { ok: true; record: PendingActionRecord }
  | { ok: false; reason: 'expired' | 'rejected' };

/** Injectable store for pending actions (in-memory fake in tests). */
export interface PendingActionStore {
  put(record: PendingActionRecord): Promise<void>;
  /**
   * Atomically consume a pending action for a session. Returns the record on
   * success, or a reason: `expired` (TTL elapsed) / `rejected` (missing, wrong
   * session, or already consumed). MUST be single-use.
   */
  consume(sessionId: string, actionId: string, nowMs: number): Promise<ConsumeResult>;
}

export interface CreatePendingActionInput {
  session_id: string;
  slug: SkillSlug;
  kind: Kind;
  client_id: string;
  args: Record<string, unknown>;
  nowMs: number;
  newId: () => string;
  ttlSeconds?: number;
}

/** Build a `PendingActionRecord` + its public `PendingAction` view (no I/O). */
export function createPendingAction(input: CreatePendingActionInput): {
  record: PendingActionRecord;
  view: PendingAction;
} {
  const ttl = input.ttlSeconds ?? PENDING_ACTION_TTL_SECONDS;
  const expiresAtMs = input.nowMs + ttl * 1000;
  const action_id = input.newId();
  const record: PendingActionRecord = {
    action_id,
    session_id: input.session_id,
    slug: input.slug,
    kind: input.kind,
    client_id: input.client_id,
    args: input.args,
    expires_at_ms: expiresAtMs,
    consumed: false,
  };
  const view: PendingAction = {
    action_id,
    slug: input.slug,
    kind: input.kind,
    client_id: input.client_id,
    args_preview: input.args,
    expires_at: new Date(expiresAtMs).toISOString(),
  };
  return { record, view };
}

/**
 * In-memory single-use store. Suitable for a single serverless instance / tests;
 * production may swap in a Redis-backed implementation behind the same interface.
 */
export class InMemoryPendingActionStore implements PendingActionStore {
  private readonly byId = new Map<string, PendingActionRecord>();

  async put(record: PendingActionRecord): Promise<void> {
    this.byId.set(record.action_id, record);
  }

  async consume(sessionId: string, actionId: string, nowMs: number): Promise<ConsumeResult> {
    const record = this.byId.get(actionId);
    // Wrong session or unknown id -> rejected (do not disclose existence).
    if (record === undefined || record.session_id !== sessionId || record.consumed) {
      return { ok: false, reason: 'rejected' };
    }
    if (nowMs > record.expires_at_ms) {
      // Burn the expired token so it can never be replayed.
      this.byId.delete(actionId);
      return { ok: false, reason: 'expired' };
    }
    // Single-use: mark consumed before returning.
    record.consumed = true;
    this.byId.set(actionId, record);
    return { ok: true, record };
  }
}
