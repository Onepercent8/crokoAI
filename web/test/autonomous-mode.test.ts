import { describe, expect, it } from 'vitest';

import {
  assertPlanValid,
  decideTick,
  isForwardTransition,
  milestoneKey,
  newEvents,
  type AgentEvent,
  type Phase,
  type TickInput,
  type WatchState,
} from '../lib/nexus/autonomous-mode';

function watch(overrides: Partial<WatchState> = {}): WatchState {
  return {
    id: 'w1',
    phase: 'watching',
    hasReview: false,
    last_event_ts: null,
    last_narrated_milestone: null,
    ...overrides,
  };
}

function ev(ts: string, type: AgentEvent['event_type'], label?: string): AgentEvent {
  return label === undefined ? { ts, event_type: type } : { ts, event_type: type, label };
}

describe('phase ordering: isForwardTransition', () => {
  it('allows forward and same-phase, blocks regression', () => {
    expect(isForwardTransition('watching', 'reviewing')).toBe(true);
    expect(isForwardTransition('watching', 'watching')).toBe(true);
    expect(isForwardTransition('reviewing', 'watching')).toBe(false);
    expect(isForwardTransition('notifying', 'reviewing')).toBe(false);
  });
  it('allows any active phase to fail, but terminal states never move', () => {
    expect(isForwardTransition('watching', 'failed')).toBe(true);
    expect(isForwardTransition('reviewing', 'failed')).toBe(true);
    expect(isForwardTransition('done', 'failed')).toBe(false);
    expect(isForwardTransition('done', 'notifying')).toBe(false);
    expect(isForwardTransition('failed', 'watching')).toBe(false);
  });
});

describe('cursors: newEvents / milestoneKey (idempotency core)', () => {
  it('returns only events strictly after the cursor, sorted', () => {
    const events = [
      ev('2026-01-01T00:03:00Z', 'step'),
      ev('2026-01-01T00:01:00Z', 'step'),
      ev('2026-01-01T00:02:00Z', 'step'),
    ];
    const out = newEvents(events, '2026-01-01T00:01:00Z');
    expect(out.map((e) => e.ts)).toEqual(['2026-01-01T00:02:00Z', '2026-01-01T00:03:00Z']);
  });
  it('returns all events when the cursor is null', () => {
    const events = [ev('b', 'step'), ev('a', 'step')];
    expect(newEvents(events, null).map((e) => e.ts)).toEqual(['a', 'b']);
  });
  it('milestone key is derived from the timestamp (monotone)', () => {
    expect(milestoneKey(ev('2026-01-01T00:00:00Z', 'step'))).toBe('step:2026-01-01T00:00:00Z');
  });
});

describe('decideTick: ≤1 narration per tick', () => {
  it('narrates at most one progress milestone while watching', () => {
    const input: TickInput = {
      watch: watch(),
      jobStatus: 'running',
      events: [ev('t1', 'step', 'Etapa 1'), ev('t2', 'step', 'Etapa 2')],
    };
    const plan = decideTick(input);
    expect(plan.narration).not.toBeNull();
    expect(plan.narration?.text).toBe('Etapa 1');
    // Cursor advances only to the narrated step so the next tick takes step 2.
    expect(plan.nextEventCursor).toBe('t1');
    expect(plan.nextMilestone).toBe('step:t1');
    expect(plan.nextPhase).toBe('watching');
  });

  it('does not re-narrate an already-narrated milestone (idempotent)', () => {
    const input: TickInput = {
      watch: watch({ last_event_ts: 't1', last_narrated_milestone: 'step:t1' }),
      jobStatus: 'running',
      events: [ev('t1', 'step', 'Etapa 1'), ev('t2', 'step', 'Etapa 2')],
    };
    const plan = decideTick(input);
    // Only t2 is new → it is the single narration this tick.
    expect(plan.narration?.text).toBe('Etapa 2');
    expect(plan.nextMilestone).toBe('step:t2');
  });

  it('re-running the same tick produces no new narration (cursor consumed)', () => {
    const first = decideTick({
      watch: watch(),
      jobStatus: 'running',
      events: [ev('t1', 'step', 'E1')],
    });
    const second = decideTick({
      watch: watch({
        last_event_ts: first.nextEventCursor,
        last_narrated_milestone: first.nextMilestone,
      }),
      jobStatus: 'running',
      events: [ev('t1', 'step', 'E1')],
    });
    expect(second.narration).toBeNull();
  });
});

describe('decideTick: phase advancement', () => {
  it('watching → notifying on completed without review', () => {
    const plan = decideTick({ watch: watch(), jobStatus: 'completed', events: [] });
    expect(plan.nextPhase).toBe('notifying');
    expect(plan.narration?.kind).toBe('status');
  });

  it('watching → reviewing on completed with review', () => {
    const plan = decideTick({
      watch: watch({ hasReview: true }),
      jobStatus: 'completed',
      events: [],
    });
    expect(plan.nextPhase).toBe('reviewing');
  });

  it('reviewing → notifying with an opinion narration', () => {
    const plan = decideTick({
      watch: watch({ phase: 'reviewing', hasReview: true }),
      jobStatus: 'completed',
      events: [],
      reviewOutcome: { kind: 'opinion', text: 'Boa página.', imagePath: 'nexus-review/x.png' },
    });
    expect(plan.nextPhase).toBe('notifying');
    expect(plan.narration?.kind).toBe('opinion');
    expect(plan.narration?.imagePath).toBe('nexus-review/x.png');
  });

  it('reviewing degrades to a system note when capture is blocked (SSRF)', () => {
    const plan = decideTick({
      watch: watch({ phase: 'reviewing', hasReview: true }),
      jobStatus: 'completed',
      events: [],
      reviewOutcome: { kind: 'blocked', reason: 'ssrf: host outside allowlist' },
    });
    expect(plan.nextPhase).toBe('notifying'); // does NOT stall
    expect(plan.narration?.kind).toBe('system');
  });

  it('notifying → done, narrating delivery', () => {
    const plan = decideTick({
      watch: watch({ phase: 'notifying' }),
      jobStatus: 'completed',
      events: [],
      notifyOutcome: { delivered: true },
    });
    expect(plan.nextPhase).toBe('done');
    expect(plan.result).toMatchObject({ phase: 'done', notified: true });
  });

  it('notifying → done even when email degraded to log (fail-safe)', () => {
    const plan = decideTick({
      watch: watch({ phase: 'notifying' }),
      jobStatus: 'completed',
      events: [],
      notifyOutcome: { delivered: false, degradedToLog: true },
    });
    expect(plan.nextPhase).toBe('done'); // NOT failed
    expect(plan.result).toMatchObject({ notified: false });
  });
});

describe('decideTick: failure path', () => {
  it('any active phase → failed when the job fails, with a system narration', () => {
    const plan = decideTick({
      watch: watch(),
      jobStatus: 'failed',
      events: [ev('t1', 'error', 'meta rejected')],
    });
    expect(plan.nextPhase).toBe('failed');
    expect(plan.narration?.kind).toBe('system');
    expect(plan.result).toMatchObject({ phase: 'failed', reason: 'meta rejected' });
  });

  it('terminal watches are a no-op', () => {
    for (const phase of ['done', 'failed'] as Phase[]) {
      const plan = decideTick({ watch: watch({ phase }), jobStatus: 'completed', events: [] });
      expect(plan.narration).toBeNull();
      expect(plan.nextPhase).toBe(phase);
    }
  });
});

describe('assertPlanValid: defense in depth', () => {
  it('throws on an illegal regression', () => {
    expect(() =>
      assertPlanValid('notifying', {
        nextPhase: 'watching',
        narration: null,
        nextEventCursor: null,
        nextMilestone: null,
        result: null,
      }),
    ).toThrow(/illegal phase transition/);
  });
  it('accepts a valid forward plan', () => {
    expect(() =>
      assertPlanValid('watching', {
        nextPhase: 'notifying',
        narration: { text: 'ok', kind: 'status', milestone: 'm' },
        nextEventCursor: null,
        nextMilestone: 'm',
        result: null,
      }),
    ).not.toThrow();
  });
  it('rejects an empty narration text', () => {
    expect(() =>
      assertPlanValid('watching', {
        nextPhase: 'watching',
        narration: { text: '   ', kind: 'status', milestone: 'm' },
        nextEventCursor: null,
        nextMilestone: 'm',
        result: null,
      }),
    ).toThrow();
  });
});
