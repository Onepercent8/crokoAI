import type { PublishKind } from './landing-pages';

/**
 * landing-publish — enqueue a heavy landing-page job (SPEC-012, ADR 0009).
 *
 * The editor only ENQUEUES `landing_publish`/`landing_edit` into `agent_jobs`;
 * the runner builds + serves. Dedup is enforced by the DB partial unique index
 * `uq_agent_jobs_active_landing_kind` (at most one active job per
 * `(landing_page_id, kind)`): a unique violation maps to `already_queued`.
 *
 * The DB write is behind an injectable port so the route uses the real
 * `service_role` client while tests inject a fake (no network).
 */

const UNIQUE_VIOLATION = '23505';

export interface LandingJobInsert {
  landing_page_id: string;
  skill: string;
  kind: PublishKind;
  args: Record<string, unknown>;
  status: 'pending';
  requested_by: string;
}

export type LandingInsertResult = { conflict: false; id: string } | { conflict: true };

/** Injectable inserter for landing jobs (real REST in prod, fake in tests). */
export interface LandingJobInserter {
  insert(row: LandingJobInsert): Promise<LandingInsertResult>;
}

export interface BuildLandingJobInput {
  landingPageId: string;
  kind: PublishKind;
  /** Server-resolved skill name (never free text from the client). */
  skill: string;
  requestedBy?: string;
}

/** Build the exact `agent_jobs` row to enqueue (pure; no I/O). */
export function buildLandingJob(input: BuildLandingJobInput): LandingJobInsert {
  return {
    landing_page_id: input.landingPageId,
    skill: input.skill,
    kind: input.kind,
    args: { landing_page_id: input.landingPageId },
    status: 'pending',
    requested_by: input.requestedBy ?? 'dashboard',
  };
}

export type LandingEnqueueOutcome =
  | { status: 'queued'; agent_job_id: string }
  | { status: 'already_queued'; agent_job_id: null };

/** Insert the landing job, mapping a unique-violation to `already_queued`. */
export async function enqueueLandingJob(
  inserter: LandingJobInserter,
  row: LandingJobInsert,
): Promise<LandingEnqueueOutcome> {
  const result = await inserter.insert(row);
  if (result.conflict) {
    return { status: 'already_queued', agent_job_id: null };
  }
  return { status: 'queued', agent_job_id: result.id };
}

/** Map a Supabase/Postgres error to the conflict signal (testable). */
export function isLandingUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

/**
 * Server-side skill allowlist for landing kinds (never trust free text). Mirrors
 * the Nexus allowlist pattern (`lib/nexus/tools.ts`).
 */
const LANDING_SKILL_BY_KIND = {
  landing_publish: 'publish-landing-page-cliente-exemplo',
  landing_edit: 'publish-landing-page-cliente-exemplo',
} as const satisfies Record<PublishKind, string>;

/** Resolve a landing kind to its skill name; `null` for an unknown kind. */
export function resolveLandingSkill(kind: string): { kind: PublishKind; skill: string } | null {
  if (!Object.prototype.hasOwnProperty.call(LANDING_SKILL_BY_KIND, kind)) {
    return null;
  }
  const k = kind as PublishKind;
  return { kind: k, skill: LANDING_SKILL_BY_KIND[k] };
}
