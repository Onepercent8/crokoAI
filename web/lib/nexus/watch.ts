import { z } from 'zod';

/**
 * watch — start an autonomous watch over a long job (SPEC-013, Onda 9).
 *
 * When the Nexus/dashboard enqueues a heavy task (create campaign / publish LP),
 * it also creates an `autonomous_watches` row (`phase='watching'`) pointing at
 * the freshly inserted `agent_job_id`. The poller then advances it via
 * `autonomous-watch-tick`. This is the "start autonomous mode" step.
 *
 * Pure builder + injectable insert port (real REST + `service_role` in prod,
 * fake in tests). No I/O in the builder.
 */

/** `agent_jobs.kind` values that warrant a watch (long, narratable tasks). */
export const WATCHABLE_KINDS = [
  'create',
  'create_sales',
  'landing',
  'landing_publish',
  'landing_edit',
] as const;
export const WatchableKindSchema = z.enum(WATCHABLE_KINDS);
export type WatchableKind = z.infer<typeof WatchableKindSchema>;

/** A landing publish carries a review step (reviewing phase); others do not. */
export function kindHasReview(kind: WatchableKind): boolean {
  return kind === 'landing_publish';
}

export const StartWatchInputSchema = z.object({
  clientId: z.string().uuid(),
  agentJobId: z.string().uuid(),
  kind: WatchableKindSchema,
  sessionId: z.string().min(1).max(128),
  /** Target descriptor (e.g. landing page id / campaign id) as text. */
  targetId: z.string().max(256).optional(),
});
export type StartWatchInput = z.infer<typeof StartWatchInputSchema>;

/** The exact row inserted into `autonomous_watches` (pure build). */
export interface WatchInsert {
  client_id: string;
  target_kind: WatchableKind;
  target_id: string | null;
  agent_job_id: string;
  publish_job_id: string | null;
  session_id: string;
  phase: 'watching';
}

/** Build the `autonomous_watches` row (no I/O). */
export function buildWatch(input: StartWatchInput): WatchInsert {
  const isPublish = input.kind === 'landing_publish';
  return {
    client_id: input.clientId,
    target_kind: input.kind,
    target_id: input.targetId ?? null,
    agent_job_id: input.agentJobId,
    publish_job_id: isPublish ? input.agentJobId : null,
    session_id: input.sessionId,
    phase: 'watching',
  };
}

/** Insert port for an autonomous watch (real REST in prod, fake in tests). */
export interface WatchInserter {
  /** Insert one `autonomous_watches` row; resolve its id. */
  insert(row: WatchInsert): Promise<{ id: string }>;
}

/** Create the watch row for a freshly enqueued job. */
export async function startWatch(
  inserter: WatchInserter,
  input: StartWatchInput,
): Promise<{ watch_id: string }> {
  const row = buildWatch(input);
  const { id } = await inserter.insert(row);
  return { watch_id: id };
}
