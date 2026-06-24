/**
 * Activation orchestrator (wave 5, SPEC-000 §8 Onda 5 / §10).
 *
 * Turns a PAUSED Meta entity ON — the ONLY write in the system that starts real
 * spend. It is FAIL-CLOSED: it re-reads the entity from Meta and revalidates
 * (correct client account, currently PAUSED, budget within the cap) and ABORTS
 * on ANY doubt; there is no force path. On success it flips the entity and logs
 * exactly one `operation_logs` row with `action='activate'` (append-only).
 *
 * Pure orchestration over injected ports (Meta read+activate, catalogue,
 * persistence, manifest). NO direct I/O — fully testable OFFLINE with fakes.
 *
 * Invariants enforced here:
 *  - revalidate-before-activate (assertActivationSafe), abort on doubt;
 *  - only `activateEntity` is ever called (minimal mutation surface);
 *  - one operation_log per activation, action='activate', no PII/secrets;
 *  - idempotent: an already-ACTIVE entity short-circuits (no double flip);
 *  - manifest JSON per attempt (completed | skipped | failed), no secrets/PII.
 */

import { asCents } from '../domain/money.js';
import { assertActivationSafe, CAMPAIGN_STATUS_PAUSED } from '../domain/meta-guards.js';
import { resolveIdempotencyKey } from '../domain/idempotency.js';
import { ActivateArgsSchema, type ActivateArgs } from '../domain/schemas.js';
import type { ClientRecord, MetaActivationPort } from './ports.js';

const SKILL_ACTOR = 'skill:activate-campaign';
const STATUS_ACTIVE = 'ACTIVE';

/** Persistence boundary for activation (REST + service_role in production). */
export interface ActivationPersistencePort {
  insertOperationLog(row: {
    entity_type: 'campaign' | 'ad_set' | 'ad';
    entity_id: string;
    action: 'activate';
    actor: string;
    summary: string;
  }): Promise<{ id: string }>;
}

export interface ActivationManifest {
  run_id: string;
  idempotency_key: string;
  kind: 'activate';
  client_slug: string;
  meta_entity_id: string;
  entity_type: 'campaign' | 'ad_set' | 'ad';
  status: 'completed' | 'skipped' | 'failed';
  /** The entity's status BEFORE this run (audit trail). */
  status_before: string | null;
  /** The entity's status AFTER this run (ACTIVE on success). */
  status_after: string | null;
  started_at: string;
  finished_at: string;
  error?: string;
}

export interface OrchestrateActivationDeps {
  meta: MetaActivationPort;
  catalogueLoadClient: (slug: string) => Promise<ClientRecord>;
  persistence: ActivationPersistencePort;
  writeManifest: (m: ActivationManifest, stampIso: string) => Promise<string>;
  clock: { now(): Date; newRunId(): string };
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface OrchestrateActivationResult {
  status: 'completed' | 'skipped';
  manifestPath: string;
  manifest: ActivationManifest;
  /** True when the entity was already ACTIVE (idempotent short-circuit). */
  reusedExisting: boolean;
}

/**
 * Run the activation skill end to end against injected ports.
 *
 * Throws on any revalidation failure AFTER writing a `failed` manifest (no flip
 * happens). On success returns the `completed` manifest. If the entity is
 * already ACTIVE it returns a `skipped` manifest (idempotent, no second flip).
 */
export async function orchestrateActivation(
  rawArgs: unknown,
  deps: OrchestrateActivationDeps,
): Promise<OrchestrateActivationResult> {
  const log = deps.log ?? (() => {});
  const runId = deps.clock.newRunId();
  const startedAt = deps.clock.now().toISOString();

  let idempotencyKey = 'pending-validation';
  let clientSlug = 'unknown';
  let metaEntityId = 'unknown';
  let entityType: 'campaign' | 'ad_set' | 'ad' = 'campaign';

  const failAndThrow = async (error: unknown, statusBefore: string | null): Promise<never> => {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = deps.clock.now().toISOString();
    const failed: ActivationManifest = {
      run_id: runId,
      idempotency_key: idempotencyKey,
      kind: 'activate',
      client_slug: clientSlug,
      meta_entity_id: metaEntityId,
      entity_type: entityType,
      status: 'failed',
      status_before: statusBefore,
      status_after: null,
      started_at: startedAt,
      finished_at: finishedAt,
      error: message,
    };
    await deps.writeManifest(failed, finishedAt);
    log('skill.failed', { run_id: runId, error: message });
    throw new Error(`Failed to activate campaign: ${message}`);
  };

  let probedStatus: string | null = null;
  try {
    // 1. Validate args (boundary; data, not instruction).
    const args: ActivateArgs = ActivateArgsSchema.parse(rawArgs);
    clientSlug = args.client_slug;
    metaEntityId = args.meta_entity_id;
    entityType = args.entity_type;
    idempotencyKey = resolveIdempotencyKey(args.idempotency_key, {
      client_slug: args.client_slug,
      product_slug: args.meta_entity_id,
      at: startedAt,
    });
    log('skill.start', { run_id: runId, client_slug: args.client_slug });

    // 2. Resolve the client (allowlist server-side) — gives the allowed account + cap.
    const client = await deps.catalogueLoadClient(args.client_slug);

    // 3. Re-read the entity from Meta (NEVER trust args for the activation decision).
    const probe = await deps.meta.getEntity(args.meta_entity_id);
    probedStatus = probe.status;

    // 4. Idempotency: an already-ACTIVE entity is a no-op (no double flip / spend dup).
    if (probe.status === STATUS_ACTIVE) {
      log('skill.idempotent-skip', { run_id: runId, reason: 'already-active' });
      const finishedAt = deps.clock.now().toISOString();
      const manifest: ActivationManifest = {
        run_id: runId,
        idempotency_key: idempotencyKey,
        kind: 'activate',
        client_slug: client.slug,
        meta_entity_id: args.meta_entity_id,
        entity_type: args.entity_type,
        status: 'skipped',
        status_before: STATUS_ACTIVE,
        status_after: STATUS_ACTIVE,
        started_at: startedAt,
        finished_at: finishedAt,
      };
      const path = await deps.writeManifest(manifest, finishedAt);
      return { status: 'skipped', manifestPath: path, manifest, reusedExisting: true };
    }

    // 5. Fail-closed revalidation: abort on ANY doubt (correct account, PAUSED, cap).
    assertActivationSafe(
      {
        meta_entity_id: probe.meta_entity_id,
        ad_account_id: probe.ad_account_id,
        status: probe.status,
        daily_budget_cents: probe.daily_budget_cents,
      },
      {
        client_ad_account_id: client.ad_account_id,
        daily_budget_cap_cents: asCents(client.daily_budget_cap_cents),
        intended_entity_id: args.meta_entity_id,
      },
    );

    // 6. Flip ON (the single mutation strictly required) + verify the new status.
    const { status: statusAfter } = await deps.meta.activateEntity(args.meta_entity_id);
    if (statusAfter !== STATUS_ACTIVE) {
      throw new Error(`activation did not take effect (status="${statusAfter}")`);
    }

    // 7. One append-only operation_log, action='activate'.
    await deps.persistence.insertOperationLog({
      entity_type: args.entity_type,
      entity_id: args.meta_entity_id,
      action: 'activate',
      actor: SKILL_ACTOR,
      summary: `activated ${args.entity_type} (was ${CAMPAIGN_STATUS_PAUSED})`,
    });

    // 8. Completed manifest (no secrets/PII).
    const finishedAt = deps.clock.now().toISOString();
    const manifest: ActivationManifest = {
      run_id: runId,
      idempotency_key: idempotencyKey,
      kind: 'activate',
      client_slug: client.slug,
      meta_entity_id: args.meta_entity_id,
      entity_type: args.entity_type,
      status: 'completed',
      status_before: CAMPAIGN_STATUS_PAUSED,
      status_after: STATUS_ACTIVE,
      started_at: startedAt,
      finished_at: finishedAt,
    };
    const manifestPath = await deps.writeManifest(manifest, finishedAt);
    log('skill.completed', { run_id: runId, meta_entity_id: args.meta_entity_id });
    return { status: 'completed', manifestPath, manifest, reusedExisting: false };
  } catch (error) {
    return failAndThrow(error, probedStatus);
  }
}
