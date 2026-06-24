import { z } from 'zod';

/**
 * Autonomous mode — the pure phase machine for a Nexus watch (SPEC-013, Onda 9).
 *
 * When a long task runs on the runner (create campaign / publish landing page),
 * a row in `autonomous_watches` advances through a phase machine. On each tick
 * the runner reads the NEW `agent_events` of the job, decides AT MOST ONE
 * narration, and progresses the phase. Everything moves through the DB — there
 * is no push between planes (SPEC-000 §3).
 *
 * This module is pure (no I/O). The skill `autonomous-watch-tick` and
 * `scripts/poll-autonomous-watches.sh` wire it to REST + `service_role`. The
 * decision function returns a plan; the caller persists it in one transaction.
 *
 * Invariants enforced here:
 *  - ≤1 narration per tick (the plan carries at most one narration).
 *  - Idempotent by cursors: only events with `ts > last_event_ts` and milestones
 *    beyond `last_narrated_milestone` are considered.
 *  - Phase advances monotonically forward (or to `failed`); never regresses.
 *  - Email/Telegram failure degrades to log — never marks the watch `failed`.
 */

// --- Phases ------------------------------------------------------------------

export const PHASES = ['watching', 'reviewing', 'notifying', 'done', 'failed'] as const;
export const PhaseSchema = z.enum(PHASES);
export type Phase = z.infer<typeof PhaseSchema>;

/** Strict forward ordering of the active+terminal phases (for monotonicity). */
const PHASE_ORDER: Record<Phase, number> = {
  watching: 0,
  reviewing: 1,
  notifying: 2,
  done: 3,
  failed: 3, // terminal alongside `done`; reached only on error
};

/** Is `next` a legal forward transition from `current` (no regression)? */
export function isForwardTransition(current: Phase, next: Phase): boolean {
  if (next === 'failed') {
    return current !== 'done' && current !== 'failed';
  }
  if (current === 'done' || current === 'failed') {
    return false; // terminal states never move
  }
  return PHASE_ORDER[next] >= PHASE_ORDER[current];
}

// --- Narration ---------------------------------------------------------------

export const NarrationKindSchema = z.enum(['status', 'opinion', 'system']);
export type NarrationKind = z.infer<typeof NarrationKindSchema>;

export interface PlannedNarration {
  /** Text spoken to the operator. Treated as DATA, never PII (SPEC-013 §Seg). */
  text: string;
  kind: NarrationKind;
  /** Milestone key written to `last_narrated_milestone` (monotonic per watch). */
  milestone: string;
  /** Optional storage path of a captured frame (review phase). */
  imagePath?: string;
}

// --- Inputs ------------------------------------------------------------------

/** A single `agent_events` row the tick reads (subset relevant to the machine). */
export interface AgentEvent {
  /** ISO-8601 timestamp; used against the `last_event_ts` cursor. */
  ts: string;
  event_type: 'start' | 'step' | 'decision' | 'error' | 'end';
  /** Optional human label for the step (the milestone text source). */
  label?: string;
}

export type JobStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';

/** The watch row as the tick sees it (cursors + identity). */
export interface WatchState {
  id: string;
  phase: Phase;
  /** Whether the watched publish job carries a landing-page review step. */
  hasReview: boolean;
  last_event_ts: string | null;
  last_narrated_milestone: string | null;
}

export interface TickInput {
  watch: WatchState;
  /** Status of the watched `agent_jobs` row. */
  jobStatus: JobStatus;
  /** All `agent_events` of the job (the tick filters by cursor). */
  events: AgentEvent[];
  /**
   * Whether the review step (capture + opinion) already produced its narration
   * this run. Supplied by the caller after attempting the live review.
   */
  reviewOutcome?: ReviewOutcome;
  /** Whether the external notification (email/Telegram) succeeded this tick. */
  notifyOutcome?: NotifyOutcome;
}

/** Result of the live-review side effect (degrades safely). */
export type ReviewOutcome =
  | { kind: 'opinion'; text: string; imagePath: string }
  | { kind: 'blocked'; reason: string } // SSRF guard / outside allowlist
  | { kind: 'failed'; reason: string }; // capture/render error

/** Result of the external notification side effect (always best-effort). */
export type NotifyOutcome = { delivered: true } | { delivered: false; degradedToLog: true };

// --- Plan (output of the pure decision) --------------------------------------

export interface TickPlan {
  /** The phase to persist (>= current; or `failed`). */
  nextPhase: Phase;
  /** AT MOST ONE narration to insert this tick (≤1 invariant). */
  narration: PlannedNarration | null;
  /** New `last_event_ts` cursor (max ts considered), or unchanged. */
  nextEventCursor: string | null;
  /** New `last_narrated_milestone`, or unchanged. */
  nextMilestone: string | null;
  /** Terminal `result` payload (no PII), set only on done/failed. */
  result: Record<string, unknown> | null;
}

// --- Cursor helpers ----------------------------------------------------------

/** Events strictly after the cursor, oldest-first. Idempotency core. */
export function newEvents(events: AgentEvent[], cursor: string | null): AgentEvent[] {
  const filtered = cursor === null ? events.slice() : events.filter((e) => e.ts > cursor);
  return filtered.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

/** The latest ts among events (for advancing the cursor), or the old cursor. */
function maxTs(events: AgentEvent[], cursor: string | null): string | null {
  let max = cursor;
  for (const e of events) {
    if (max === null || e.ts > max) {
      max = e.ts;
    }
  }
  return max;
}

/** Stable milestone key for a progress step (monotonic via timestamp). */
export function milestoneKey(event: AgentEvent): string {
  return `step:${event.ts}`;
}

/** Has this milestone already been narrated (cursor comparison)? */
function alreadyNarrated(milestone: string, last: string | null): boolean {
  // Milestones are `step:<iso-ts>`; lexical compare on the ts suffix is monotone.
  return last !== null && milestone <= last;
}

// --- Decision ----------------------------------------------------------------

/**
 * Decide the plan for ONE tick. Pure and deterministic: same inputs → same plan.
 * Produces at most one narration and never regresses the phase.
 */
export function decideTick(input: TickInput): TickPlan {
  const { watch } = input;

  // Terminal watches do nothing (defense; the claim RPC already filters them).
  if (watch.phase === 'done' || watch.phase === 'failed') {
    return noOp(watch);
  }

  // Job failed → fail the machine with a system narration (once).
  if (input.jobStatus === 'failed' || input.jobStatus === 'cancelled') {
    return failPlan(watch, input);
  }

  // --- Phase: watching -------------------------------------------------------
  if (watch.phase === 'watching') {
    return decideWatching(input);
  }

  // --- Phase: reviewing ------------------------------------------------------
  if (watch.phase === 'reviewing') {
    return decideReviewing(input);
  }

  // --- Phase: notifying ------------------------------------------------------
  return decideNotifying(input);
}

function noOp(watch: WatchState): TickPlan {
  return {
    nextPhase: watch.phase,
    narration: null,
    nextEventCursor: watch.last_event_ts,
    nextMilestone: watch.last_narrated_milestone,
    result: null,
  };
}

function failPlan(watch: WatchState, input: TickInput): TickPlan {
  // Find an error event for a (non-PII) reason; fall back to a generic message.
  const errorEvent = input.events.find((e) => e.event_type === 'error');
  const reason = errorEvent?.label ?? 'job failed';
  return {
    nextPhase: 'failed',
    narration: {
      text: `A tarefa falhou: ${reason}.`,
      kind: 'system',
      milestone: 'phase:failed',
    },
    nextEventCursor: maxTs(input.events, watch.last_event_ts),
    nextMilestone: 'phase:failed',
    result: { phase: 'failed', reason },
  };
}

function decideWatching(input: TickInput): TickPlan {
  const { watch } = input;
  const pending = newEvents(input.events, watch.last_event_ts);

  // Narrate the earliest un-narrated progress step (≤1 per tick), if any.
  const step = pending.find(
    (e) =>
      (e.event_type === 'step' || e.event_type === 'decision') &&
      !alreadyNarrated(milestoneKey(e), watch.last_narrated_milestone),
  );

  // Job completed → advance out of watching.
  if (input.jobStatus === 'completed') {
    const nextPhase: Phase = watch.hasReview ? 'reviewing' : 'notifying';
    return {
      nextPhase,
      narration: {
        text: watch.hasReview
          ? 'A tarefa terminou. Vou revisar a página publicada.'
          : 'A tarefa terminou com sucesso.',
        kind: 'status',
        milestone: 'phase:completed',
      },
      nextEventCursor: maxTs(input.events, watch.last_event_ts),
      nextMilestone: 'phase:completed',
      result: null,
    };
  }

  // Still running: narrate at most one progress milestone.
  if (step !== undefined) {
    const milestone = milestoneKey(step);
    return {
      nextPhase: 'watching',
      narration: {
        text: step.label ?? 'Progresso na tarefa.',
        kind: 'status',
        milestone,
      },
      // Advance the event cursor only up to the narrated step so the next tick
      // can pick up the following step (one milestone per tick).
      nextEventCursor: step.ts,
      nextMilestone: milestone,
      result: null,
    };
  }

  // Nothing new to say; advance the event cursor to avoid rescanning old events.
  return {
    nextPhase: 'watching',
    narration: null,
    nextEventCursor: maxTs(input.events, watch.last_event_ts),
    nextMilestone: watch.last_narrated_milestone,
    result: null,
  };
}

function decideReviewing(input: TickInput): TickPlan {
  const { watch } = input;
  const review = input.reviewOutcome;

  // The review side effect runs before decideTick; we narrate its outcome once.
  if (review === undefined) {
    // No review computed yet this tick — stay in reviewing without narrating.
    return {
      nextPhase: 'reviewing',
      narration: null,
      nextEventCursor: watch.last_event_ts,
      nextMilestone: watch.last_narrated_milestone,
      result: null,
    };
  }

  if (review.kind === 'opinion') {
    return {
      nextPhase: 'notifying',
      narration: {
        text: review.text,
        kind: 'opinion',
        milestone: 'phase:reviewed',
        imagePath: review.imagePath,
      },
      nextEventCursor: watch.last_event_ts,
      nextMilestone: 'phase:reviewed',
      result: null,
    };
  }

  // Blocked (SSRF) or failed capture → degrade: narrate a system note, continue.
  const note =
    review.kind === 'blocked'
      ? 'Não foi possível revisar a página (URL fora do domínio permitido).'
      : 'Não consegui capturar a página para revisar; sigo para a notificação.';
  return {
    nextPhase: 'notifying',
    narration: {
      text: note,
      kind: 'system',
      milestone: 'phase:reviewed',
    },
    nextEventCursor: watch.last_event_ts,
    nextMilestone: 'phase:reviewed',
    result: null,
  };
}

function decideNotifying(input: TickInput): TickPlan {
  const { watch } = input;
  const notify = input.notifyOutcome;

  // Notification is best-effort. Whether delivered or degraded-to-log, we close.
  const degraded = notify !== undefined && notify.delivered === false;
  return {
    nextPhase: 'done',
    narration: {
      text: degraded
        ? 'Tudo pronto. (Não consegui enviar a notificação externa; registrei no log.)'
        : 'Tudo pronto. Avisei por e-mail.',
      kind: 'status',
      milestone: 'phase:done',
    },
    nextEventCursor: watch.last_event_ts,
    nextMilestone: 'phase:done',
    result: { phase: 'done', notified: notify?.delivered ?? false },
  };
}

// --- Plan validation (defense in depth before persisting) --------------------

/**
 * Assert a plan respects the machine's invariants. Throws on violation so a
 * buggy decision can never persist an illegal transition or >1 narration.
 */
export function assertPlanValid(current: Phase, plan: TickPlan): void {
  if (!isForwardTransition(current, plan.nextPhase)) {
    throw new Error(`illegal phase transition: ${current} -> ${plan.nextPhase}`);
  }
  // `narration` is a single object or null → ≤1 narration by construction; this
  // keeps the invariant explicit for readers/auditors.
  if (plan.narration !== null && plan.narration.text.trim().length === 0) {
    throw new Error('narration text must be non-empty');
  }
}
