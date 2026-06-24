/**
 * Injectable ports for the traffic-skill orchestrator
 * (create-traffic-campaign §Comportamento).
 *
 * Every external boundary (Meta MCP, image generation, catalogue lookup,
 * Supabase REST, manifest fs) is expressed here as an interface so the
 * orchestrator is pure orchestration and fully testable OFFLINE with fakes.
 * The Meta API is NEVER called from this package; the runner supplies an
 * adapter backed by the `mcp-meta-ads` connector (SPEC-000 §10).
 */

import type { Cents } from '../domain/money.js';
import type {
  CopyOutput,
  CreativeAngle,
  ImagePrompt,
  ProductBrief,
  ScrapeFacts,
} from '../domain/schemas.js';

/** The `clients` row fields the traffic skill needs (resolved server-side). */
export interface ClientRecord {
  id: string;
  slug: string;
  ad_account_id: string;
  facebook_page_id: string;
  currency: string;
  daily_budget_cap_cents: number;
  default_landing_url: string;
}

/**
 * Catalogue + clients lookup. The brief comes from a local file
 * (`produtos/<slug>.json`), the client row from Supabase. Both are validated by
 * the adapter before being handed back (data, not instruction).
 */
export interface CataloguePort {
  /** Load + validate the product brief for (client, product). */
  loadBrief(clientSlug: string, productSlug: string): Promise<ProductBrief>;
  /** Resolve the client row by slug (allowlist server-side). */
  loadClient(clientSlug: string): Promise<ClientRecord>;
}

/** scrape-extractor subagent boundary: landing_url -> validated facts. */
export interface ScrapePort {
  extract(brief: ProductBrief): Promise<ScrapeFacts>;
}

/** copywriter subagent boundary: facts -> exactly 3 angles. */
export interface CopyPort {
  write(brief: ProductBrief, facts: ScrapeFacts): Promise<CopyOutput>;
}

/** image-prompt-generator subagent boundary: copies -> one prompt per angle. */
export interface ImagePromptPort {
  generate(facts: ScrapeFacts, copies: CopyOutput): Promise<ImagePrompt[]>;
}

/** Result of generating + uploading one creative image to `ad-ingest`. */
export interface GeneratedImage {
  generated_image_id: string;
  /** Public https URL in the `ad-ingest` bucket (goes in link_data.picture). */
  public_url: string;
  storage_path: string;
  width: number;
  height: number;
  model: string;
  cost_usd_estimate: number;
}

/** image-generate skill boundary: prompt -> image in the public bucket. */
export interface ImageGeneratePort {
  generate(input: {
    clientSlug: string;
    productSlug: string;
    angle: CreativeAngle;
    prompt: string;
    aspect: string;
  }): Promise<GeneratedImage>;
}

/** A campaign spec sent to the Meta MCP (campaign is ALWAYS born PAUSED). */
export interface MetaCampaignSpec {
  ad_account_id: string;
  objective: 'OUTCOME_TRAFFIC';
  budget_mode: 'CBO' | 'ABO';
  daily_budget_cents: Cents;
  status: 'PAUSED';
  special_ad_categories: string[];
}

export interface MetaAdSetSpec {
  meta_campaign_id: string;
  optimization_goal: string;
  billing_event: string;
  /** Present for traffic; OMITTED for OUTCOME_SALES (wave 5). */
  destination_type?: string;
  targeting: Record<string, unknown>;
  advantage_audience: boolean;
  advantage_placements: boolean;
}

export interface MetaCreativeSpec {
  meta_ad_set_id: string;
  page_id: string;
  angle: CreativeAngle;
  headline: string;
  primary_text: string;
  description?: string;
  call_to_action_type: string;
  link_url: string;
  /** Public URL; the adapter places it inline in link_data.picture. */
  image_url: string;
}

export interface MetaAdSpec {
  meta_ad_set_id: string;
  meta_creative_id: string;
}

/**
 * Meta Ads mutation boundary (the ONLY way the skill touches Meta).
 * The adapter wraps the `mcp-meta-ads` connector; in tests it is a fake that
 * never reaches the network. Every method returns the external (text) id.
 */
export interface MetaAdsPort {
  createCampaign(spec: MetaCampaignSpec): Promise<{ meta_campaign_id: string }>;
  createAdSet(spec: MetaAdSetSpec): Promise<{ meta_ad_set_id: string }>;
  createCreative(spec: MetaCreativeSpec): Promise<{ meta_creative_id: string }>;
  createAd(spec: MetaAdSpec): Promise<{ meta_ad_id: string }>;
}

/* ------------------------------------------------------------------ *
 *  Wave 5 — activation                                                *
 * ------------------------------------------------------------------ */

/** Live Meta entity state read back before activation (read side). */
export interface MetaEntityState {
  meta_entity_id: string;
  ad_account_id: string;
  /** Current effective status reported by Meta (e.g. PAUSED/ACTIVE). */
  status: string;
  daily_budget_cents: Cents;
}

/**
 * Activation boundary (wave 5): READ the entity back, then turn it ON.
 *
 * Surface is deliberately MINIMAL — only `getEntity` (read) + `activateEntity`
 * (the single mutation strictly required to flip a PAUSED entity to ACTIVE).
 * No pause/delete/budget-change is exposed, so the activation skill can do
 * nothing beyond what it is for. The adapter wraps `mcp-meta-ads`.
 */
export interface MetaActivationPort {
  /** Re-read the entity from Meta for fail-closed revalidation. */
  getEntity(metaEntityId: string): Promise<MetaEntityState>;
  /** Flip a PAUSED entity to ACTIVE; returns the new effective status. */
  activateEntity(metaEntityId: string): Promise<{ status: string }>;
}

/* ------------------------------------------------------------------ *
 *  Wave 5 — sales campaign                                            *
 * ------------------------------------------------------------------ */

/** One existing creative with its window performance (read side). */
export interface WinningCreative {
  meta_creative_id: string;
  purchases: number;
  purchase_value_cents: number;
}

/**
 * Sales campaign spec (OUTCOME_SALES). The campaign is ALWAYS born PAUSED; the
 * conversion event is the pixel PURCHASE on the client's dataset/pixel.
 */
export interface MetaSalesCampaignSpec {
  ad_account_id: string;
  objective: 'OUTCOME_SALES';
  budget_mode: 'CBO' | 'ABO';
  daily_budget_cents: Cents;
  status: 'PAUSED';
  special_ad_categories: string[];
}

/**
 * Sales ad-set spec. GOTCHA (SPEC-000 §10): for OUTCOME_SALES the
 * `destination_type` field is OMITTED entirely (Meta v25) — it is intentionally
 * absent from this interface so it cannot be sent by accident. The pixel +
 * PURCHASE event drive optimization instead.
 */
export interface MetaSalesAdSetSpec {
  meta_campaign_id: string;
  optimization_goal: 'OFFSITE_CONVERSIONS';
  billing_event: string;
  /** The client's conversion dataset/pixel id (text). */
  pixel_id: string;
  /** Custom-conversion / standard event optimized for: always PURCHASE here. */
  custom_event_type: 'PURCHASE';
  targeting: Record<string, unknown>;
  advantage_audience: boolean;
  advantage_placements: boolean;
}

/**
 * Sales Meta boundary (wave 5): list winning creatives (read) and create the
 * OUTCOME_SALES hierarchy reusing existing creative ids (no creative creation).
 */
export interface MetaSalesPort {
  /** Read existing creatives + their purchases over a window (read-only). */
  listWinningCreatives(clientSlug: string, windowDays: number): Promise<WinningCreative[]>;
  createSalesCampaign(spec: MetaSalesCampaignSpec): Promise<{ meta_campaign_id: string }>;
  createSalesAdSet(spec: MetaSalesAdSetSpec): Promise<{ meta_ad_set_id: string }>;
  /** Reuse an existing winning creative id in a new sales ad. */
  createSalesAd(spec: MetaAdSpec): Promise<{ meta_ad_id: string }>;
}

/** The `clients` row fields the sales skill needs (adds pixel_id over base). */
export interface SalesClientRecord extends ClientRecord {
  /** Conversion dataset/pixel id for the PURCHASE event (text, from Meta). */
  pixel_id: string;
}
