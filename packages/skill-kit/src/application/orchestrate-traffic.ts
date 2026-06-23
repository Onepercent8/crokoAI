/**
 * Traffic-campaign orchestrator (create-traffic-campaign §Comportamento).
 *
 * Pure orchestration over injected ports (Meta, images, catalogue, subagents)
 * and the skill-kit's pure helpers. NO direct I/O, NO network: every boundary is
 * a port, so the whole happy path + error paths are tested OFFLINE with fakes.
 *
 * Non-negotiable invariants enforced here (SPEC-000 §10):
 *  - campaign ALWAYS born PAUSED;
 *  - daily_budget_cents clamped to the client cap (clamp, not abort);
 *  - destination_type PRESENT for OUTCOME_TRAFFIC (omitted only for SALES);
 *  - Advantage+ placements => omit placements (advantage_placements=true);
 *  - image inline in link_data.picture (public ad-ingest URL);
 *  - exactly 3 angles (autoridade/dor/oferta);
 *  - one operation_log per Meta mutation (append-only);
 *  - idempotent re-run (same key => no recreate);
 *  - manifest JSON per attempt (completed | failed), no secrets/PII.
 */

import { CAMPAIGN_STATUS_PAUSED, assertCampaignSpecSafe } from '../domain/meta-guards.js';
import { asCents, type Cents } from '../domain/money.js';
import { resolveIdempotencyKey } from '../domain/idempotency.js';
import { buildOperationLog } from '../domain/operation-log.js';
import {
  CREATIVE_ANGLES,
  CreateTrafficArgsSchema,
  assertAllAnglesCovered,
  type CopyAngle,
  type CreateTrafficArgs,
  type CreativeAngle,
  type ImagePrompt,
} from '../domain/schemas.js';
import type { Manifest } from '../domain/manifest.js';
import {
  buildAdRow,
  buildAdSetRow,
  buildCampaignRow,
  buildCreativeRow,
  buildGeneratedImageRow,
} from './build-rows.js';
import {
  checkIdempotency,
  type ActiveCampaignProbe,
  type CompletedManifestReader,
} from './check-idempotency.js';
import { resolveBudget } from './resolve-budget.js';
import type {
  CataloguePort,
  CopyPort,
  GeneratedImage,
  ImageGeneratePort,
  ImagePromptPort,
  MetaAdsPort,
  ScrapePort,
} from './ports.js';

/** Default ad-set tuning for traffic (Advantage+ => omit placements). */
const TRAFFIC_OPTIMIZATION_GOAL = 'LANDING_PAGE_VIEWS';
const TRAFFIC_BILLING_EVENT = 'IMPRESSIONS';
const TRAFFIC_DESTINATION_TYPE = 'WEBSITE';
const SKILL_ACTOR = 'skill:create-traffic';

/** Persistence boundary the orchestrator needs (kept minimal + injectable). */
export interface PersistencePort {
  upsert(
    table: string,
    row: Record<string, unknown>,
    options: { onConflict: string },
  ): Promise<Record<string, unknown>>;
  insertOperationLog(row: {
    entity_type: 'campaign' | 'ad_set' | 'creative' | 'ad';
    entity_id: string;
    action: 'create';
    actor: string;
    summary: string;
  }): Promise<Record<string, unknown>>;
}

/** Writes the manifest and returns the path written. */
export type ManifestWriterFn = (manifest: Manifest, stampIso: string) => Promise<string>;

/** A clock + id source kept injectable so runs are deterministic in tests. */
export interface Clock {
  now(): Date;
  /** Stable run id for correlation with agent_events. */
  newRunId(): string;
}

export interface OrchestrateTrafficDeps {
  catalogue: CataloguePort;
  scrape: ScrapePort;
  copy: CopyPort;
  imagePrompt: ImagePromptPort;
  imageGenerate: ImageGeneratePort;
  meta: MetaAdsPort;
  persistence: PersistencePort;
  readCompletedManifest: CompletedManifestReader;
  probeActiveCampaign: ActiveCampaignProbe;
  writeManifest: ManifestWriterFn;
  clock: Clock;
  log?: (event: string, fields?: Record<string, unknown>) => void;
}

export interface OrchestrateTrafficResult {
  status: 'completed' | 'skipped';
  manifestPath: string;
  manifest: Manifest;
  /** True when idempotency short-circuited the create. */
  reusedExisting: boolean;
}

interface CreatedCreative {
  angle: CreativeAngle;
  meta_creative_id: string;
  meta_ad_id: string;
  generated_image_id: string;
  public_url: string;
}

/** Pick the copy + image-prompt for a given angle, or throw (defensive). */
function pickForAngle(
  angle: CreativeAngle,
  copies: readonly CopyAngle[],
  prompts: readonly ImagePrompt[],
): { copy: CopyAngle; prompt: ImagePrompt } {
  const copy = copies.find((c) => c.angle === angle);
  const prompt = prompts.find((p) => p.angle === angle);
  if (copy === undefined || prompt === undefined) {
    throw new Error(`Failed to assemble creative: missing copy/prompt for angle "${angle}"`);
  }
  return { copy, prompt };
}

/**
 * Run the traffic-campaign skill end to end against injected ports.
 *
 * Throws on any pre-mutation validation error AFTER writing a `failed` manifest
 * (no Meta/Supabase rows are created in that case). On success returns the
 * `completed` manifest + its path. On idempotent re-run returns the prior
 * manifest with `reusedExisting: true` and `status: 'skipped'`.
 */
export async function orchestrateTraffic(
  rawArgs: unknown,
  deps: OrchestrateTrafficDeps,
): Promise<OrchestrateTrafficResult> {
  const log = deps.log ?? (() => {});
  const runId = deps.clock.newRunId();
  const startedAt = deps.clock.now().toISOString();

  // Manifest scaffolding shared by the failure and success paths. The
  // idempotency_key/slugs are filled once args validate; until then a safe
  // placeholder is used so an early failure still writes a `failed` manifest.
  let idempotencyKey = 'pending-validation';
  let clientSlug = 'unknown';
  let productSlug = 'unknown';

  const failAndThrow = async (error: unknown): Promise<never> => {
    const message = error instanceof Error ? error.message : String(error);
    const finishedAt = deps.clock.now().toISOString();
    const failed: Manifest = {
      run_id: runId,
      idempotency_key: idempotencyKey,
      kind: 'traffic',
      client_slug: clientSlug,
      product_slug: productSlug,
      started_at: startedAt,
      status: 'failed',
      daily_budget_cents: 0,
      daily_budget_cap_cents: 0,
      budget_was_clamped: false,
      creatives: [],
      meta_campaign_id: null,
      meta_ad_set_id: null,
      finished_at: finishedAt,
      error: message,
    };
    await deps.writeManifest(failed, finishedAt);
    log('skill.failed', { run_id: runId, error: message });
    throw new Error(`Failed to create traffic campaign: ${message}`);
  };

  try {
    // 1. Validate args (boundary; data, not instruction).
    const args: CreateTrafficArgs = CreateTrafficArgsSchema.parse(rawArgs);
    clientSlug = args.client_slug;
    productSlug = args.product_slug;
    idempotencyKey = resolveIdempotencyKey(args.idempotency_key, {
      client_slug: args.client_slug,
      product_slug: args.product_slug,
      at: startedAt,
    });
    log('skill.start', { run_id: runId, client_slug: args.client_slug });

    const baseManifest = {
      run_id: runId,
      idempotency_key: idempotencyKey,
      kind: 'traffic' as const,
      client_slug: args.client_slug,
      product_slug: args.product_slug,
      started_at: startedAt,
    };

    // 2. Idempotency: short-circuit on a prior completed manifest / active campaign.
    const decision = await checkIdempotency(
      idempotencyKey,
      deps.readCompletedManifest,
      deps.probeActiveCampaign,
    );
    if (decision.alreadyDone && decision.existing !== null) {
      log('skill.idempotent-skip', { run_id: runId, reason: decision.reason });
      const path = await deps.writeManifest(decision.existing, startedAt);
      return {
        status: 'skipped',
        manifestPath: path,
        manifest: decision.existing,
        reusedExisting: true,
      };
    }
    if (decision.alreadyDone) {
      // Active campaign but no manifest to reuse: refuse to recreate (no spend dup).
      throw new Error('an active campaign already exists for this scope');
    }

    // 3. Resolve catalogue (brief + client row; both validated by the adapter).
    const brief = await deps.catalogue.loadBrief(args.client_slug, args.product_slug);
    const client = await deps.catalogue.loadClient(args.client_slug);

    // 4. Resolve + clamp the budget to the client cap (clamp, never abort).
    const budget = resolveBudget({
      argDailyBudgetCents: args.daily_budget_cents,
      briefDailyBudgetCents: client.daily_budget_cap_cents,
      capCents: client.daily_budget_cap_cents,
    });

    // 5. Subagents (untrusted output validated inside each adapter).
    const facts = await deps.scrape.extract(brief);
    const copies = await deps.copy.write(brief, facts);
    assertAllAnglesCovered(copies);
    const prompts = await deps.imagePrompt.generate(facts, copies);

    // 6. Generate one image per angle into the public ad-ingest bucket.
    const images = new Map<CreativeAngle, GeneratedImage>();
    for (const angle of CREATIVE_ANGLES) {
      const { prompt } = pickForAngle(angle, copies, prompts);
      const image = await deps.imageGenerate.generate({
        clientSlug: args.client_slug,
        productSlug: args.product_slug,
        angle,
        prompt: prompt.prompt,
        aspect: prompt.aspect,
      });
      if (!image.public_url.startsWith('https://')) {
        throw new Error(`image for angle "${angle}" has a non-public URL`);
      }
      images.set(angle, image);
    }
    if (images.size === 0) {
      throw new Error('no creative image could be generated');
    }

    // 7. Meta hierarchy (ALWAYS PAUSED). Guard the spec before each write.
    const campaignSpec = {
      ad_account_id: client.ad_account_id,
      objective: 'OUTCOME_TRAFFIC' as const,
      budget_mode: args.budget_mode,
      daily_budget_cents: budget.dailyBudgetCents,
      status: CAMPAIGN_STATUS_PAUSED,
      special_ad_categories: [] as string[],
    };
    assertCampaignSpecSafe({
      status: campaignSpec.status,
      objective: campaignSpec.objective,
      daily_budget_cents: campaignSpec.daily_budget_cents,
      daily_budget_cap_cents: asCents(client.daily_budget_cap_cents),
      destination_type: TRAFFIC_DESTINATION_TYPE,
    });

    const { meta_campaign_id } = await deps.meta.createCampaign(campaignSpec);
    await deps.persistence.insertOperationLog({
      entity_type: 'campaign',
      entity_id: meta_campaign_id,
      action: 'create',
      actor: SKILL_ACTOR,
      summary: `created PAUSED traffic campaign (cap-clamped=${budget.wasClamped})`,
    });

    const adSetSpec = {
      meta_campaign_id,
      optimization_goal: TRAFFIC_OPTIMIZATION_GOAL,
      billing_event: TRAFFIC_BILLING_EVENT,
      // Present for traffic; omitted ONLY for OUTCOME_SALES (wave 5).
      destination_type: TRAFFIC_DESTINATION_TYPE,
      targeting: { geo_locations: { countries: [client.currency === 'BRL' ? 'BR' : 'US'] } },
      // Advantage+ audience + placements => omit explicit placements.
      advantage_audience: true,
      advantage_placements: true,
    };
    const { meta_ad_set_id } = await deps.meta.createAdSet(adSetSpec);
    await deps.persistence.insertOperationLog({
      entity_type: 'ad_set',
      entity_id: meta_ad_set_id,
      action: 'create',
      actor: SKILL_ACTOR,
      summary: 'created traffic ad set (advantage+ placements)',
    });

    const linkUrl = brief.landing_url;
    const created: CreatedCreative[] = [];
    for (const angle of CREATIVE_ANGLES) {
      const image = images.get(angle);
      if (image === undefined) {
        continue;
      }
      const { copy } = pickForAngle(angle, copies, prompts);
      const creativeSpec = {
        meta_ad_set_id,
        page_id: client.facebook_page_id,
        angle,
        headline: copy.headline,
        primary_text: copy.primary_text,
        ...(copy.description !== undefined ? { description: copy.description } : {}),
        call_to_action_type: brief.call_to_action_type,
        link_url: linkUrl,
        image_url: image.public_url, // adapter places it inline in link_data.picture
      };
      const { meta_creative_id } = await deps.meta.createCreative(creativeSpec);
      await deps.persistence.insertOperationLog({
        entity_type: 'creative',
        entity_id: meta_creative_id,
        action: 'create',
        actor: SKILL_ACTOR,
        summary: `created creative (${angle})`,
      });

      const { meta_ad_id } = await deps.meta.createAd({ meta_ad_set_id, meta_creative_id });
      await deps.persistence.insertOperationLog({
        entity_type: 'ad',
        entity_id: meta_ad_id,
        action: 'create',
        actor: SKILL_ACTOR,
        summary: `created ad (${angle})`,
      });

      created.push({
        angle,
        meta_creative_id,
        meta_ad_id,
        generated_image_id: image.generated_image_id,
        public_url: image.public_url,
      });
    }

    if (created.length === 0) {
      throw new Error('no creative/ad was created');
    }

    // 8. Persist the hierarchy via REST, in hierarchy order, every row w/ raw_spec.
    const supabaseIds: Record<string, string[]> = {
      campaigns: [],
      ad_sets: [],
      creatives: [],
      ads: [],
      generated_images: [],
    };

    const campaignRow = await deps.persistence.upsert(
      'campaigns',
      buildCampaignRow({
        client_id: client.id,
        meta_campaign_id,
        objective: 'OUTCOME_TRAFFIC',
        budget_mode: args.budget_mode,
        daily_budget_cents: budget.dailyBudgetCents,
        raw_spec: campaignSpec,
      }),
      { onConflict: 'meta_campaign_id' },
    );
    pushId(supabaseIds, 'campaigns', campaignRow);
    const campaignId = rowId(campaignRow);

    const adSetRow = await deps.persistence.upsert(
      'ad_sets',
      buildAdSetRow({
        campaign_id: campaignId,
        meta_ad_set_id,
        optimization_goal: adSetSpec.optimization_goal,
        billing_event: adSetSpec.billing_event,
        destination_type: adSetSpec.destination_type,
        targeting: adSetSpec.targeting,
        advantage_audience: adSetSpec.advantage_audience,
        advantage_placements: adSetSpec.advantage_placements,
        raw_spec: adSetSpec,
      }),
      { onConflict: 'meta_ad_set_id' },
    );
    pushId(supabaseIds, 'ad_sets', adSetRow);
    const adSetId = rowId(adSetRow);

    for (const c of created) {
      const image = images.get(c.angle);
      const { copy, prompt } = pickForAngle(c.angle, copies, prompts);
      if (image !== undefined) {
        const giRow = await deps.persistence.upsert(
          'generated_images',
          buildGeneratedImageRow({
            storage_bucket: 'ad-ingest',
            storage_path: image.storage_path,
            width: image.width,
            height: image.height,
            model: image.model,
            prompt: prompt.prompt,
            aspect: prompt.aspect,
            cost_usd_estimate: image.cost_usd_estimate,
            raw_spec: { angle: c.angle, prompt: prompt.prompt },
          }),
          { onConflict: 'storage_path' },
        );
        pushId(supabaseIds, 'generated_images', giRow);
      }

      const creativeRow = await deps.persistence.upsert(
        'creatives',
        buildCreativeRow({
          meta_creative_id: c.meta_creative_id,
          angle: c.angle,
          headline: copy.headline,
          primary_text: copy.primary_text,
          ...(copy.description !== undefined ? { description: copy.description } : {}),
          call_to_action_type: brief.call_to_action_type,
          link_url: linkUrl,
          image_url: c.public_url,
          page_id: client.facebook_page_id,
          generated_image_id: c.generated_image_id,
          raw_spec: { angle: c.angle, headline: copy.headline },
        }),
        { onConflict: 'meta_creative_id' },
      );
      pushId(supabaseIds, 'creatives', creativeRow);
      const creativeId = rowId(creativeRow);

      const adRow = await deps.persistence.upsert(
        'ads',
        buildAdRow({
          ad_set_id: adSetId,
          meta_ad_id: c.meta_ad_id,
          creative_id: creativeId,
          effective_status: CAMPAIGN_STATUS_PAUSED,
          raw_spec: { angle: c.angle },
        }),
        { onConflict: 'meta_ad_id' },
      );
      pushId(supabaseIds, 'ads', adRow);
    }

    // 9. Write the completed manifest (no secrets/PII).
    const finishedAt = deps.clock.now().toISOString();
    const manifest: Manifest = {
      ...baseManifest,
      status: 'completed',
      daily_budget_cents: budget.dailyBudgetCents,
      daily_budget_cap_cents: budget.capCents,
      budget_was_clamped: budget.wasClamped,
      brief: { name: brief.name, landing_url: brief.landing_url, currency: brief.currency },
      scrape_facts: { promise: facts.promise, offer: facts.offer },
      copies: copies.map((c) => ({ angle: c.angle, headline: c.headline })),
      creatives: created.map((c) => ({
        angle: c.angle,
        meta_creative_id: c.meta_creative_id,
        meta_ad_id: c.meta_ad_id,
        generated_image_id: c.generated_image_id,
        public_url: c.public_url,
      })),
      meta_campaign_id,
      meta_ad_set_id,
      supabase_ids: supabaseIds,
      finished_at: finishedAt,
    };
    const manifestPath = await deps.writeManifest(manifest, finishedAt);
    log('skill.completed', { run_id: runId, meta_campaign_id });
    return { status: 'completed', manifestPath, manifest, reusedExisting: false };
  } catch (error) {
    return failAndThrow(error);
  }
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

/** Re-export the budget cents type for adapter authors. */
export type { Cents };
