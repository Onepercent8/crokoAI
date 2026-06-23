import type { LpEventRow } from '../src/derive.js';
import type { Destination, EdgeStore, FanoutContext, Logger, LpEventsSink } from '../src/ports.js';

/** In-memory edge store for rate limit + dedup. */
export class MemoryStore implements EdgeStore {
  counters = new Map<string, number>();
  seen = new Set<string>();

  async incrementRateCounter(key: string): Promise<number> {
    const next = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, next);
    return next;
  }

  async hasEvent(eventId: string): Promise<boolean> {
    return this.seen.has(eventId);
  }

  async markEvent(eventId: string): Promise<void> {
    this.seen.add(eventId);
  }
}

/** Records inserted lp_events rows; can simulate a duplicate / failure. */
export class MemorySink implements LpEventsSink {
  rows: LpEventRow[] = [];
  failNext = false;
  treatAsDuplicate = false;

  async insert(row: LpEventRow): Promise<{ inserted: boolean }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mock sink failure');
    }
    if (this.treatAsDuplicate) {
      return { inserted: false };
    }
    this.rows.push(row);
    return { inserted: true };
  }
}

/** A destination that records calls; can be configured to throw. */
export class RecordingDestination implements Destination {
  calls: FanoutContext[] = [];
  constructor(
    public readonly name: string,
    private readonly shouldFail = false,
  ) {}

  async send(ctx: FanoutContext): Promise<void> {
    this.calls.push(ctx);
    if (this.shouldFail) {
      throw new Error(`${this.name} failed`);
    }
  }
}

/** Captures log lines so tests can assert NO-PII. */
export class CapturingLogger implements Logger {
  lines: Array<{ level: string; message: string; fields?: Record<string, unknown> }> = [];
  info(message: string, fields?: Record<string, unknown>): void {
    this.lines.push({ level: 'info', message, ...(fields ? { fields } : {}) });
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.lines.push({ level: 'error', message, ...(fields ? { fields } : {}) });
  }
}

/** Runs deferred promises synchronously so tests can await fan-out. */
export function collectDefer(): {
  defer: (p: Promise<unknown>) => void;
  settle: () => Promise<void>;
} {
  const pending: Array<Promise<unknown>> = [];
  return {
    defer: (p) => pending.push(p),
    settle: async () => {
      await Promise.all(pending);
    },
  };
}

/** A valid track event (template placeholders only). */
export function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: '11111111-1111-4111-8111-111111111111',
    event_type: 'purchase',
    occurred_at: '2026-06-23T12:00:00.000Z',
    landing_page_id: '22222222-2222-4222-8222-222222222222',
    utm: { source: 'meta', medium: 'cpc', campaign: 'curso-exemplo' },
    value_cents: 19700,
    currency: 'brl',
    email: 'Lead@Example.com',
    phone: '+55 (11) 99999-0000',
    ...overrides,
  };
}
