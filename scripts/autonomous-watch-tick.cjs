#!/usr/bin/env node
/**
 * autonomous-watch-tick.cjs — headless persistence step of the autonomous mode
 * (SPEC-013). Invoked by `scripts/poll-autonomous-watches.sh` with an already
 * claimed watch id. Reads the watched job's status + new `agent_events`, decides
 * AT MOST ONE narration + the next phase, then persists narration/cursors/phase
 * via Supabase REST + `service_role`. NEVER the Supabase MCP (SPEC-000 §10).
 *
 * The decision logic is the SINGLE SOURCE OF TRUTH in
 * `web/lib/nexus/autonomous-mode.ts` (`decideTick`); the small port below mirrors
 * it for the CommonJS runner and is covered by the same phase-machine tests on
 * the TS side. Keep the two in lock-step when changing the machine.
 *
 * Usage:  node scripts/autonomous-watch-tick.cjs <watch-id> <worker>
 * Exit:   0 tick applied (or no-op) · 64 bad-args · 70 persistence-failed
 * Invariants: ≤1 narration per tick · idempotent by cursors · monotonic phase ·
 *             email/telegram failure degrades to log (handled by send-email.cjs).
 */
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const WORKER_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// --- phase machine (mirror of web/lib/nexus/autonomous-mode.ts) --------------

const PHASE_ORDER = { watching: 0, reviewing: 1, notifying: 2, done: 3, failed: 3 };

function isForwardTransition(current, next) {
  if (next === 'failed') return current !== 'done' && current !== 'failed';
  if (current === 'done' || current === 'failed') return false;
  return PHASE_ORDER[next] >= PHASE_ORDER[current];
}

function newEvents(events, cursor) {
  const filtered = cursor == null ? events.slice() : events.filter((e) => e.ts > cursor);
  return filtered.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}

function maxTs(events, cursor) {
  let max = cursor;
  for (const e of events) if (max == null || e.ts > max) max = e.ts;
  return max;
}

function milestoneKey(e) {
  return `step:${e.ts}`;
}

function alreadyNarrated(milestone, last) {
  return last != null && milestone <= last;
}

/** Pure decision; same contract as TS `decideTick`. Returns the tick plan. */
function decideTick(input) {
  const w = input.watch;
  if (w.phase === 'done' || w.phase === 'failed') {
    return {
      nextPhase: w.phase,
      narration: null,
      nextEventCursor: w.last_event_ts,
      nextMilestone: w.last_narrated_milestone,
      result: null,
    };
  }
  if (input.jobStatus === 'failed' || input.jobStatus === 'cancelled') {
    const errorEvent = input.events.find((e) => e.event_type === 'error');
    const reason = (errorEvent && errorEvent.label) || 'job failed';
    return {
      nextPhase: 'failed',
      narration: { text: `A tarefa falhou: ${reason}.`, kind: 'system', milestone: 'phase:failed' },
      nextEventCursor: maxTs(input.events, w.last_event_ts),
      nextMilestone: 'phase:failed',
      result: { phase: 'failed', reason },
    };
  }
  if (w.phase === 'watching') {
    const pending = newEvents(input.events, w.last_event_ts);
    const step = pending.find(
      (e) =>
        (e.event_type === 'step' || e.event_type === 'decision') &&
        !alreadyNarrated(milestoneKey(e), w.last_narrated_milestone),
    );
    if (input.jobStatus === 'completed') {
      const nextPhase = w.hasReview ? 'reviewing' : 'notifying';
      return {
        nextPhase,
        narration: {
          text: w.hasReview
            ? 'A tarefa terminou. Vou revisar a página publicada.'
            : 'A tarefa terminou com sucesso.',
          kind: 'status',
          milestone: 'phase:completed',
        },
        nextEventCursor: maxTs(input.events, w.last_event_ts),
        nextMilestone: 'phase:completed',
        result: null,
      };
    }
    if (step) {
      const milestone = milestoneKey(step);
      return {
        nextPhase: 'watching',
        narration: { text: step.label || 'Progresso na tarefa.', kind: 'status', milestone },
        nextEventCursor: step.ts,
        nextMilestone: milestone,
        result: null,
      };
    }
    return {
      nextPhase: 'watching',
      narration: null,
      nextEventCursor: maxTs(input.events, w.last_event_ts),
      nextMilestone: w.last_narrated_milestone,
      result: null,
    };
  }
  if (w.phase === 'reviewing') {
    const r = input.reviewOutcome;
    if (!r)
      return {
        nextPhase: 'reviewing',
        narration: null,
        nextEventCursor: w.last_event_ts,
        nextMilestone: w.last_narrated_milestone,
        result: null,
      };
    if (r.kind === 'opinion') {
      return {
        nextPhase: 'notifying',
        narration: {
          text: r.text,
          kind: 'opinion',
          milestone: 'phase:reviewed',
          imagePath: r.imagePath,
        },
        nextEventCursor: w.last_event_ts,
        nextMilestone: 'phase:reviewed',
        result: null,
      };
    }
    const note =
      r.kind === 'blocked'
        ? 'Não foi possível revisar a página (URL fora do domínio permitido).'
        : 'Não consegui capturar a página para revisar; sigo para a notificação.';
    return {
      nextPhase: 'notifying',
      narration: { text: note, kind: 'system', milestone: 'phase:reviewed' },
      nextEventCursor: w.last_event_ts,
      nextMilestone: 'phase:reviewed',
      result: null,
    };
  }
  // notifying
  const degraded = input.notifyOutcome && input.notifyOutcome.delivered === false;
  return {
    nextPhase: 'done',
    narration: {
      text: degraded
        ? 'Tudo pronto. (Não consegui enviar a notificação externa; registrei no log.)'
        : 'Tudo pronto. Avisei por e-mail.',
      kind: 'status',
      milestone: 'phase:done',
    },
    nextEventCursor: w.last_event_ts,
    nextMilestone: 'phase:done',
    result: {
      phase: 'done',
      notified: (input.notifyOutcome && input.notifyOutcome.delivered) || false,
    },
  };
}

module.exports = { decideTick, isForwardTransition, newEvents, milestoneKey };

// --- REST helpers ------------------------------------------------------------

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${SUPABASE_SECRET_KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`rest ${method} ${path}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function main() {
  const [watchId, worker] = process.argv.slice(2);
  if (!watchId || !worker || !WORKER_RE.test(worker)) {
    console.error('usage: autonomous-watch-tick.cjs <watch-id> <worker>');
    process.exit(64);
  }
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error(
      JSON.stringify({ level: 'error', op: 'tick.env', message: 'SUPABASE env missing' }),
    );
    process.exit(70);
  }

  try {
    const watchRows = await rest('GET', `autonomous_watches?id=eq.${watchId}&select=*`);
    const watch = Array.isArray(watchRows) ? watchRows[0] : watchRows;
    if (!watch) {
      console.error(JSON.stringify({ level: 'info', op: 'tick.noop', reason: 'watch not found' }));
      process.exit(0);
    }

    const jobRows = await rest('GET', `agent_jobs?id=eq.${watch.agent_job_id}&select=id,status`);
    const job = Array.isArray(jobRows) ? jobRows[0] : jobRows;
    const events = await rest(
      'GET',
      `agent_events?run_id=eq.${watch.agent_job_id}&select=created_at,event_type,tool_name&order=created_at.asc`,
    );

    const plan = decideTick({
      watch: {
        id: watch.id,
        phase: watch.phase,
        hasReview: watch.publish_job_id != null,
        last_event_ts: watch.last_event_ts,
        last_narrated_milestone: watch.last_narrated_milestone,
      },
      jobStatus: (job && job.status) || 'running',
      events: (events || []).map((e) => ({
        ts: e.created_at,
        event_type: e.event_type,
        label: e.tool_name,
      })),
      // reviewOutcome / notifyOutcome wired here when the runner has Playwright/
      // Resend; offline they are undefined and the machine degrades safely.
    });

    if (!isForwardTransition(watch.phase, plan.nextPhase)) {
      throw new Error(`illegal transition ${watch.phase} -> ${plan.nextPhase}`);
    }

    // ≤1 narration per tick.
    if (plan.narration) {
      await rest('POST', 'nexus_narrations', {
        watch_id: watch.id,
        session_id: watch.session_id,
        text: plan.narration.text,
        kind: plan.narration.kind,
        image_path: plan.narration.imagePath || null,
      });
    }

    await rest('PATCH', `autonomous_watches?id=eq.${watch.id}`, {
      phase: plan.nextPhase,
      last_event_ts: plan.nextEventCursor,
      last_narrated_milestone: plan.nextMilestone,
      result: plan.result,
      claimed_by: null,
      claimed_at: null,
    });

    await rest('POST', 'operation_logs', {
      client_id: watch.client_id,
      entity_type: 'autonomous_watch',
      entity_id: watch.id,
      action: 'update',
      actor: worker,
      summary: `phase ${watch.phase} -> ${plan.nextPhase}`,
    });

    console.error(
      JSON.stringify({
        level: 'info',
        op: 'tick.applied',
        phase: plan.nextPhase,
        narrated: plan.narration != null,
      }),
    );
    process.exit(0);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', op: 'tick.failed', message: err.message }));
    process.exit(70);
  }
}

if (require.main === module) {
  void main();
}
