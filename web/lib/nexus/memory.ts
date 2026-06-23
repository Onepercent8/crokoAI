import type { LlmMessage } from './llm';

/**
 * Short-term session memory for the Nexus chat loop (SPEC-016 §"memory").
 *
 * Holds a bounded history per `session_id` so multi-turn conversations keep
 * context without unbounded growth. No PII is logged. The store is injectable
 * so the route uses a process/Redis-backed implementation while tests use the
 * in-memory fake.
 */

/** Maximum number of messages retained per session (sliding window). */
export const MAX_HISTORY_MESSAGES = 40;

export interface SessionMemory {
  /** Append a message to the session history (oldest dropped past the cap). */
  append(sessionId: string, message: LlmMessage): Promise<void>;
  /** Read the current history for a session (empty if unknown). */
  history(sessionId: string): Promise<LlmMessage[]>;
}

/** In-memory session memory (single instance / tests). */
export class InMemorySessionMemory implements SessionMemory {
  private readonly bySession = new Map<string, LlmMessage[]>();

  async append(sessionId: string, message: LlmMessage): Promise<void> {
    const existing = this.bySession.get(sessionId) ?? [];
    existing.push(message);
    // Sliding window: keep only the most recent messages.
    const trimmed =
      existing.length > MAX_HISTORY_MESSAGES
        ? existing.slice(existing.length - MAX_HISTORY_MESSAGES)
        : existing;
    this.bySession.set(sessionId, trimmed);
  }

  async history(sessionId: string): Promise<LlmMessage[]> {
    return [...(this.bySession.get(sessionId) ?? [])];
  }
}
