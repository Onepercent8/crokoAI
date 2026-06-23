/**
 * Ephemeral screen-context store for `/capture` (SPEC-016 §"capture_screen").
 *
 * A captured frame is normalized into a short text description and stored
 * briefly under a `screen_context_id`. Frames are DATA, not instructions, and
 * are never persisted to the database — they expire after a short TTL.
 *
 * Injectable so tests use a deterministic fake; the route uses the in-memory
 * implementation.
 */

/** Default lifetime of a captured frame (seconds). */
export const SCREEN_CONTEXT_TTL_SECONDS = 300;

export interface ScreenContextStore {
  put(sessionId: string, text: string, nowMs: number, newId: () => string): Promise<string>;
  get(sessionId: string, contextId: string, nowMs: number): Promise<string | null>;
}

interface Entry {
  sessionId: string;
  text: string;
  expiresAtMs: number;
}

export class InMemoryScreenContextStore implements ScreenContextStore {
  private readonly byId = new Map<string, Entry>();

  async put(sessionId: string, text: string, nowMs: number, newId: () => string): Promise<string> {
    const id = newId();
    this.byId.set(id, {
      sessionId,
      text,
      expiresAtMs: nowMs + SCREEN_CONTEXT_TTL_SECONDS * 1000,
    });
    return id;
  }

  async get(sessionId: string, contextId: string, nowMs: number): Promise<string | null> {
    const entry = this.byId.get(contextId);
    if (entry === undefined || entry.sessionId !== sessionId) {
      return null;
    }
    if (nowMs > entry.expiresAtMs) {
      this.byId.delete(contextId);
      return null;
    }
    return entry.text;
  }
}
