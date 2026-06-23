import type { Kind } from './schemas';

/**
 * Enqueue a Nexus-requested job into `agent_jobs` (SPEC-016 §"Tools de escrita").
 *
 * Write tools NEVER mutate Meta or run a skill: they only insert a row into the
 * inter-plane queue, which the headless runner (Wave 3) later claims and
 * executes. Persistence is via Supabase REST + `SUPABASE_SECRET_KEY` (server
 * side) — NEVER the Supabase MCP (SPEC-000 §10).
 *
 * Dedup is enforced by the DB partial unique index `uq_agent_jobs_active_client_kind`
 * (at most one active job per `(client_id, kind)`). A unique-violation means a
 * job is already active -> we report `already_queued` instead of creating another.
 *
 * The DB write is hidden behind {@link JobInserter} so the route uses the real
 * `service_role` client while tests inject a fake (no network in unit tests).
 */

/** Postgres unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

export interface AgentJobInsert {
  client_id: string;
  skill: string;
  kind: Kind;
  args: Record<string, unknown>;
  status: 'pending';
  requested_by: 'nexus';
}

export interface InsertOk {
  conflict: false;
  id: string;
}
export interface InsertConflict {
  conflict: true;
}
export type InsertResult = InsertOk | InsertConflict;

/** Injectable inserter (real REST client in prod, fake in tests). */
export interface JobInserter {
  /**
   * Insert one `agent_jobs` row. Resolve `{conflict:true}` when the active-job
   * unique index rejects the insert; resolve `{conflict:false,id}` otherwise.
   * Reject (throw) on any other error.
   */
  insert(row: AgentJobInsert): Promise<InsertResult>;
}

export interface BuildJobInput {
  client_id: string;
  skill: string;
  kind: Kind;
  args: Record<string, unknown>;
}

/** Build the exact row that will be enqueued (pure; no I/O). */
export function buildAgentJob(input: BuildJobInput): AgentJobInsert {
  return {
    client_id: input.client_id,
    skill: input.skill,
    kind: input.kind,
    args: input.args,
    status: 'pending',
    requested_by: 'nexus',
  };
}

export type EnqueueOutcome =
  | { status: 'queued'; agent_job_id: string }
  | { status: 'already_queued'; agent_job_id: null };

/** Insert the job, mapping a unique-violation to `already_queued` (idempotent). */
export async function enqueueJob(
  inserter: JobInserter,
  row: AgentJobInsert,
): Promise<EnqueueOutcome> {
  const result = await inserter.insert(row);
  if (result.conflict) {
    return { status: 'already_queued', agent_job_id: null };
  }
  return { status: 'queued', agent_job_id: result.id };
}

/**
 * Map a Supabase/Postgres error to the conflict signal. Exported for reuse by
 * the real inserter and for unit testing the mapping.
 */
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}
