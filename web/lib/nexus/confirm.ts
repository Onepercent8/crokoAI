import { buildAgentJob, enqueueJob, type JobInserter } from './enqueue';
import type { PendingActionStore } from './pending-action';
import { resolveSkill } from './tools';
import type { ConfirmResponseT } from './schemas';

/**
 * Second-turn confirmation handler (SPEC-016 §"confirm").
 *
 * Consumes a single-use `action_id` scoped to the session and, only then,
 * enqueues the row into `agent_jobs`. This is the ONLY place a Nexus write
 * touches the queue. Expired/unknown/replayed tokens are rejected with no
 * effect; dedup is enforced by the DB unique index (-> `already_queued`).
 */
export interface ConfirmDeps {
  pendingActions: PendingActionStore;
  inserter: JobInserter;
  now: () => number;
}

export async function confirmAction(
  deps: ConfirmDeps,
  sessionId: string,
  actionId: string,
): Promise<ConfirmResponseT> {
  const consumed = await deps.pendingActions.consume(sessionId, actionId, deps.now());
  if (!consumed.ok) {
    return { enqueued: false, agent_job_id: null, status: consumed.reason };
  }

  const record = consumed.record;
  // Re-resolve the skill from the stored slug (never trust free text).
  const resolved = resolveSkill(record.slug);
  if (resolved === null) {
    return { enqueued: false, agent_job_id: null, status: 'rejected' };
  }

  const row = buildAgentJob({
    client_id: record.client_id,
    skill: resolved.skill,
    kind: record.kind,
    args: record.args,
  });

  const outcome = await enqueueJob(deps.inserter, row);
  if (outcome.status === 'queued') {
    return { enqueued: true, agent_job_id: outcome.agent_job_id, status: 'queued' };
  }
  return { enqueued: false, agent_job_id: null, status: 'already_queued' };
}
