/**
 * Persistence-row builders (create-traffic-campaign §Persistência).
 *
 * Pure assembly of the rows written via PostgREST, in hierarchy order. Every row
 * carries `raw_spec` (SPEC-000 §10). Money stays integer cents; Meta ids stay
 * strings. No I/O here — the SupabaseRestClient performs the writes.
 */

import { CAMPAIGN_STATUS_PAUSED } from '../domain/meta-guards.js';
import type { Cents } from '../domain/money.js';
import type { CreativeAngle } from '../domain/schemas.js';
import type { TableRow } from '../infrastructure/supabase-rest.js';

export interface BuildCampaignRowInput {
  client_id: string;
  meta_campaign_id: string;
  /** Traffic (wave 2) or sales (wave 5). */
  objective: 'OUTCOME_TRAFFIC' | 'OUTCOME_SALES';
  budget_mode: 'CBO' | 'ABO';
  daily_budget_cents: Cents;
  special_ad_categories?: string[];
  /** Raw spec sent to Meta (kept verbatim, no secrets). */
  raw_spec: Record<string, unknown>;
}

/** Build the `campaigns` upsert row. Campaign is ALWAYS born PAUSED. */
export function buildCampaignRow(input: BuildCampaignRowInput): TableRow {
  return {
    client_id: input.client_id,
    meta_campaign_id: input.meta_campaign_id,
    objective: input.objective,
    budget_mode: input.budget_mode,
    daily_budget_cents: input.daily_budget_cents,
    status: CAMPAIGN_STATUS_PAUSED,
    special_ad_categories: input.special_ad_categories ?? [],
    raw_spec: input.raw_spec,
  };
}

export interface BuildAdSetRowInput {
  campaign_id: string;
  meta_ad_set_id: string;
  optimization_goal: string;
  billing_event: string;
  /** Present for traffic; omitted only for OUTCOME_SALES (wave 5). */
  destination_type?: string;
  targeting: Record<string, unknown>;
  advantage_audience?: boolean;
  advantage_placements?: boolean;
  raw_spec: Record<string, unknown>;
}

/** Build the `ad_sets` upsert row. */
export function buildAdSetRow(input: BuildAdSetRowInput): TableRow {
  const row: TableRow = {
    campaign_id: input.campaign_id,
    meta_ad_set_id: input.meta_ad_set_id,
    optimization_goal: input.optimization_goal,
    billing_event: input.billing_event,
    targeting: input.targeting,
    advantage_audience: input.advantage_audience ?? false,
    advantage_placements: input.advantage_placements ?? false,
    raw_spec: input.raw_spec,
  };
  // Only include destination_type when present (omitted for OUTCOME_SALES).
  if (input.destination_type !== undefined) {
    row['destination_type'] = input.destination_type;
  }
  return row;
}

export interface BuildCreativeRowInput {
  meta_creative_id: string;
  angle: CreativeAngle;
  headline: string;
  primary_text: string;
  description?: string;
  call_to_action_type: string;
  link_url: string;
  /** Public URL from the ad-ingest bucket; goes inline in link_data.picture. */
  image_url: string;
  page_id: string;
  generated_image_id: string | null;
  raw_spec: Record<string, unknown>;
}

/** Build a `creatives` upsert row. */
export function buildCreativeRow(input: BuildCreativeRowInput): TableRow {
  const row: TableRow = {
    meta_creative_id: input.meta_creative_id,
    headline: input.headline,
    primary_text: input.primary_text,
    call_to_action_type: input.call_to_action_type,
    link_url: input.link_url,
    image_url: input.image_url,
    page_id: input.page_id,
    generated_image_id: input.generated_image_id,
    raw_spec: input.raw_spec,
  };
  if (input.description !== undefined) {
    row['description'] = input.description;
  }
  return row;
}

export interface BuildAdRowInput {
  ad_set_id: string;
  meta_ad_id: string;
  creative_id: string;
  effective_status: string;
  raw_spec: Record<string, unknown>;
}

/** Build an `ads` upsert row. */
export function buildAdRow(input: BuildAdRowInput): TableRow {
  return {
    ad_set_id: input.ad_set_id,
    meta_ad_id: input.meta_ad_id,
    creative_id: input.creative_id,
    effective_status: input.effective_status,
    raw_spec: input.raw_spec,
  };
}

export interface BuildGeneratedImageRowInput {
  storage_bucket: 'ad-ingest';
  storage_path: string;
  width: number;
  height: number;
  model: string;
  prompt: string;
  aspect: string;
  /** Estimated USD cost; stored for reporting (not money-in-cents domain). */
  cost_usd_estimate: number;
  raw_spec: Record<string, unknown>;
}

/** Build a `generated_images` upsert row. */
export function buildGeneratedImageRow(input: BuildGeneratedImageRowInput): TableRow {
  return {
    storage_bucket: input.storage_bucket,
    storage_path: input.storage_path,
    width: input.width,
    height: input.height,
    model: input.model,
    prompt: input.prompt,
    aspect: input.aspect,
    cost_usd_estimate: input.cost_usd_estimate,
    raw_spec: input.raw_spec,
  };
}
