/**
 * Sales-campaign orchestrator (wave 5, SPEC-000 §8 Onda 5 / §10).
 *
 * Creates an OUTCOME_SALES campaign optimized for the pixel PURCHASE event,
 * REUSING the top-N existing creatives by purchases (never re-generating). All
 * entities are born PAUSED (no spend until a separate activation). GOTCHA: for
 * OUTCOME_SALES the `destination_type` is OMITTED entirely (Meta v25) — the
 * sales ad-set port has no such field, so it cannot be sent by accident.
 *
 * Pure orchestration over injected ports — NO direct I/O, fully testable OFFLINE.
 *
 * Invariants enforced here:
 *  - objective OUTCOME_SALES, conversion event PURCHASE on the client pixel;
 *  - entities ALWAYS born PAUSED; budget clamped to the client cap;
 *  - destination_type OMITTED (structurally absent from the sales spec);
 *  - top-N winners reused by creative_id (no creative creation);
 *  - one operation_log per Meta mutation (append-only, action='create');
 *  - idempotent: a prior completed manifest / active sales campaign short-circuits;
 *  - manifest JSON per attempt (completed | skipped | failed), no secrets/PII.
 */

import { selectTopCreatives, type CreativeCandidate } from '../domain/creative-selection.js';
import { CAMPAIGN_STATUS_PAUSED } from '../domain/meta-guards.js';
import { resolveIdempotencyKey } from '../domain/idempotency.js';
import { CreateSalesArgsSchema, type CreateSalesArgs } from '../domain/schemas.js';
import { buildAdRow, buildAdSetRow, buildCampaignRow } from './build-rows.js';
import type { ActiveCampaignProbe } from './check-idempotency.js';
import { resolveBudget } from './resolve-budget.js';
import type { MetaSalesPort, SalesClientRecord } from './ports.js';

const SKILL_ACTOR = 'skill:create-sales';
const SALES_OPTIMIZATION_GOAL = 'OFFSITE_CONVERSIONS' as const;
const SALES_BILLING_EVENT = 'IMPRESSIONS';

/** Persistence boundary the sales orchestrator needs (kept minimal + injectable). */
export interface SalesPersistencePort {
  upsert(
    table: string,
    row: Record<string, unknown>,
    options: { onConflict: string },
  ): Promise<Record<string, unknown>>;
  insertOperationLog(row: {
    entity_type: 'campaign' | 'ad_set' | 'ad';
    entity_id: string;
    action: 'create';
    actor: string;
    summary: string;
  }): Promise<{ id: string }>;
}

export interface SalesManifestCreative {
  meta_creative_id: string;
  meta_ad_id: string | null;
  purchases: number;
  purchase_value_cents: number;
}

export interface SalesManifest {
  run_id: string;
  idempotency_key: string;
  kind: 'sales';
  client_slug: string;
  product_slug: string;
  status: 'completed' | 'skipped' | 'failed';
  daily_budget_cents: number;
  daily_budget_cap_cents: number;
  budget_was_clamped: boolean;
  window_days: number;
  top_n: number;
  reused_creatives: SalesManifestCreative[];
  meta_campaign_id: string | null;
  meta_ad_set_id: string | null;
  supabase_ids?: Record<string, string[]>;
  started_at: string;
  finished_at: string;
  error?: string;
}

/** Reads a prior completed sales manifest for an idempotency key (or null). */
export type SalesManifestReader = (idempotencyKey: string) => Promise<SalesManifest | null>;

export interface OrchestrateSalesDeps {
  meta: MetaSalesPort;
  catalogueLoadSalesClient: (slug: string) => Promise<SalesClientRecord>;
  persistence: SalesPersistencePort;
  readCompletedManifest: SalesManifestReader;
  probeActiveSalesCampaign: ActiveCampaignProbe;
  writeManifest: (m: SalesManifest, stampIso: string) => Promise<string>;
  clock: { now(): Date; newRunId(): string };
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface OrchestrateSalesResult {
  status: 'completed' | 'skipped';
  manifestPath: string;
  manifest: SalesManifest;
  reusedExisting: boolean;
}

/** Extract a row's `id` (uuid) defensively. */
function rowId(row: Record<string, unknown>): string {
  const id = row['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('Failed to persist: row has no id');
  }
  return id;
}

function pushId(acc: Record<string, string[]>, table: string, row: Record<string, unknown>): void {
  const id = row['id'];
  if (typeof id === 'string' && id.length > 0) {
    (acc[table] ??= []).push(id);
  }
}

/**
 * Run the sales-campaign skill end to end against injected ports.
 *
 * Throws on any pre-mutation failure AFTER writing a `failed` manifest (no Meta
 * rows created). On success returns the `completed` manifest; on idempotent
 * re-run returns the prior manifest with `reusedExisting: true`.
 */
export async function orchestrateSales(
  rawArgs: unknown,
  deps: OrchestrateSalesDeps,
): Promise<OrchestrateSalesResult> {
  const log = deps.log ?? (() => {});
  const runId = deps.clock.newRunId();
  const startedAt = deps.clock.now().toISOString();

  let idempotencyKey = 'pending-validation';
  let clientSlug = 'unknown';
  let productSlug = 'unknown';

  const failAndThrow = async (error: unknown): Promise<never> => {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = deps.clock.now().toISOString();
    const failed: SalesManifest = {
      run_id: runId,
      idempotency_key: idempotencyKey,
      kind: 'sales',
      client_slug: clientSlug,
      product_slug: productSlug,
      status: 'failed',
      daily_budget_cents: 0,
      daily_budget_cap_cents: 0,
      budget_was_clamped: false,
      window_days: 0,
      top_n: 0,
      reused_creatives: [],
      meta_campaign_id: null,
      meta_ad_set_id: null,
      started_at: startedAt,
      finished_at: finishedAt,
      error: message,
    };
    await deps.writeManifest(failed, finishedAt);
    log('skill.failed', { run_id: runId, error: message });
    throw new Error(`Failed to create sales campaign: ${message}`);
  };

  try {
    // 1. Validate args (boundary; data, not instruction).
    const args: CreateSalesArgs = CreateSalesArgsSchema.parse(rawArgs);
    clientSlug = args.client_slug;
    productSlug = args.product_slug;
    idempotencyKey = resolveIdempotencyKey(args.idempotency_key, {
      client_slug: args.client_slug,
      product_slug: args.product_slug,
      at: startedAt,
    });
    log('skill.start', { run_id: runId, client_slug: args.client_slug });

    // 2. Idempotency (defense in depth): a prior completed manifest short-circuits;
    //    otherwise an active sales campaign for the scope blocks a duplicate.
    const prior = await deps.readCompletedManifest(idempotencyKey);
    if (prior !== null) {
      log('skill.idempotent-skip', { run_id: runId, reason: 'completed-manifest' });
      const path = await deps.writeManifest(prior, startedAt);
      return { status: 'skipped', manifestPath: path, manifest: prior, reusedExisting: true };
    }
    if (await deps.probeActiveSalesCampaign()) {
      // Active sales campaign but no manifest to reuse: refuse to recreate.
      throw new Error('an active sales campaign already exists for this scope');
    }

    // 3. Resolve client (allowlist server-side) — gives account, cap, pixel.
    const client = await deps.catalogueLoadSalesClient(args.client_slug);

    // 4. Budget: clamp to the client cap (clamp, never abort).
    const budget = resolveBudget({
      argDailyBudgetCents: args.daily_budget_cents,
      briefDailyBudgetCents: client.daily_budget_cap_cents,
      capCents: client.daily_budget_cap_cents,
    });

    // 5. Select top-N winning creatives by purchases (read-only).
    const candidates: CreativeCandidate[] = (
      await deps.meta.listWinningCreatives(client.slug, args.window_days)
    ).map((w) => ({
      meta_creative_id: w.meta_creative_id,
      purchases: w.purchases,
      purchase_value_cents: w.purchase_value_cents,
    }));
    const winners = selectTopCreatives(candidates, args.top_n);
    if (winners.length === 0) {
      throw new Error('no winning creative with purchases to reuse');
    }

    // 6. Meta hierarchy (ALWAYS PAUSED). Campaign OUTCOME_SALES.
    const campaignSpec = {
      ad_account_id: client.ad_account_id,
      objective: 'OUTCOME_SALES' as const,
      budget_mode: args.budget_mode,
      daily_budget_cents: budget.dailyBudgetCents,
      status: CAMPAIGN_STATUS_PAUSED,
      special_ad_categories: [] as string[],
    };
    const { meta_campaign_id } = await deps.meta.createSalesCampaign(campaignSpec);
    await deps.persistence.insertOperationLog({
      entity_type: 'campaign',
      entity_id: meta_campaign_id,
      action: 'create',
      actor: SKILL_ACTOR,
      summary: `created PAUSED OUTCOME_SALES campaign (cap-clamped=${budget.wasClamped})`,
    });

    // Ad set: pixel PURCHASE, destination_type OMITTED (structurally absent).
    const adSetSpec = {
      meta_campaign_id,
      optimization_goal: SALES_OPTIMIZATION_GOAL,
      billing_event: SALES_BILLING_EVENT,
      pixel_id: client.pixel_id,
      custom_event_type: 'PURCHASE' as const,
      targeting: { geo_locations: { countries: [client.currency === 'BRL' ? 'BR' : 'US'] } },
      advantage_audience: true,
      advantage_placements: true,
    };
    const { meta_ad_set_id } = await deps.meta.createSalesAdSet(adSetSpec);
    await deps.persistence.insertOperationLog({
      entity_type: 'ad_set',
      entity_id: meta_ad_set_id,
      action: 'create',
      actor: SKILL_ACTOR,
      summary: 'created sales ad set (pixel PURCHASE, no destination_type)',
    });

    // 7. Reuse each winning creative in a new sales ad.
    const reused: SalesManifestCreative[] = [];
    for (const w of winners) {
      const { meta_ad_id } = await deps.meta.createSalesAd({
        meta_ad_set_id,
        meta_creative_id: w.meta_creative_id,
      });
      await deps.persistence.insertOperationLog({
        entity_type: 'ad',
        entity_id: meta_ad_id,
        action: 'create',
        actor: SKILL_ACTOR,
        summary: `created sales ad reusing creative ${w.meta_creative_id}`,
      });
      reused.push({
        meta_creative_id: w.meta_creative_id,
        meta_ad_id,
        purchases: w.purchases,
        purchase_value_cents: w.purchase_value_cents,
      });
    }

    // 8. Persist the hierarchy via REST (campaigns -> ad_sets -> ads), raw_spec each.
    const supabaseIds: Record<string, string[]> = { campaigns: [], ad_sets: [], ads: [] };

    const campaignRow = await deps.persistence.upsert(
      'campaigns',
      buildCampaignRow({
        client_id: client.id,
        meta_campaign_id,
        objective: 'OUTCOME_SALES',
        budget_mode: args.budget_mode,
        daily_budget_cents: budget.dailyBudgetCents,
        raw_spec: campaignSpec,
      }),
      { onConflict: 'meta_campaign_id' },
    );
    pushId(supabaseIds, 'campaigns', campaignRow);
    const campaignId = rowId(campaignRow);

    // destination_type OMITTED for OUTCOME_SALES (buildAdSetRow only adds it when present).
    const adSetRow = await deps.persistence.upsert(
      'ad_sets',
      buildAdSetRow({
        campaign_id: campaignId,
        meta_ad_set_id,
        optimization_goal: adSetSpec.optimization_goal,
        billing_event: adSetSpec.billing_event,
        targeting: adSetSpec.targeting,
        advantage_audience: adSetSpec.advantage_audience,
        advantage_placements: adSetSpec.advantage_placements,
        raw_spec: { ...adSetSpec },
      }),
      { onConflict: 'meta_ad_set_id' },
    );
    pushId(supabaseIds, 'ad_sets', adSetRow);
    const adSetId = rowId(adSetRow);

    for (const r of reused) {
      if (r.meta_ad_id === null) {
        continue;
      }
      const adRow = await deps.persistence.upsert(
        'ads',
        buildAdRow({
          ad_set_id: adSetId,
          meta_ad_id: r.meta_ad_id,
          // Reused creative: the FK to the existing creatives row is resolved by
          // the adapter via meta_creative_id; raw_spec keeps the external id.
          creative_id: r.meta_creative_id,
          effective_status: CAMPAIGN_STATUS_PAUSED,
          raw_spec: { reused_creative: r.meta_creative_id, purchases: r.purchases },
        }),
        { onConflict: 'meta_ad_id' },
      );
      pushId(supabaseIds, 'ads', adRow);
    }

    // 9. Completed manifest (no secrets/PII).
    const finishedAt = deps.clock.now().toISOString();
    const manifest: SalesManifest = {
      run_id: runId,
      idempotency_key: idempotencyKey,
      kind: 'sales',
      client_slug: client.slug,
      product_slug: args.product_slug,
      status: 'completed',
      daily_budget_cents: budget.dailyBudgetCents,
      daily_budget_cap_cents: budget.capCents,
      budget_was_clamped: budget.wasClamped,
      window_days: args.window_days,
      top_n: args.top_n,
      reused_creatives: reused,
      meta_campaign_id,
      meta_ad_set_id,
      supabase_ids: supabaseIds,
      started_at: startedAt,
      finished_at: finishedAt,
    };
    const manifestPath = await deps.writeManifest(manifest, finishedAt);
    log('skill.completed', { run_id: runId, meta_campaign_id });
    return { status: 'completed', manifestPath, manifest, reusedExisting: false };
  } catch (error) {
    return failAndThrow(error);
  }
}
