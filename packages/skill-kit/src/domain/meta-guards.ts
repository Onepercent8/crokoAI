/**
 * Meta Ads gotcha guards (SPEC-000 §10, create-traffic-campaign §Invariantes).
 *
 * Pure invariant checks applied BEFORE any MCP `mcp-meta-ads` write. These do
 * not call the Meta API; they fail fast on specs that would violate a known
 * gotcha so the actual mutation never happens.
 */

import type { Cents } from './money.js';

/** Campaign status: a campaign ALWAYS starts PAUSED in this system. */
export const CAMPAIGN_STATUS_PAUSED = 'PAUSED' as const;
export type CampaignStatus = 'PAUSED' | 'ACTIVE';

/** Minimal campaign spec subset relevant to gotcha guards. */
export interface CampaignSpecGuardInput {
  status: string;
  objective: string;
  daily_budget_cents: Cents;
  daily_budget_cap_cents: Cents;
  /** Present for traffic; omitted only for OUTCOME_SALES (wave 5). */
  destination_type?: string | undefined;
}

/**
 * Guard the campaign spec against Meta gotchas + budget cap.
 * Throws on any violation; returns void on success.
 *
 * - Campaign must be born PAUSED (no write in this wave turns on spend).
 * - daily_budget_cents must be <= daily_budget_cap_cents.
 * - OUTCOME_SALES must OMIT destination_type (only enforced if objective set).
 */
export function assertCampaignSpecSafe(input: CampaignSpecGuardInput): void {
  if (input.status !== CAMPAIGN_STATUS_PAUSED) {
    throw new Error(`Failed to guard campaign: status must be PAUSED, got "${input.status}"`);
  }
  if (input.daily_budget_cents > input.daily_budget_cap_cents) {
    throw new Error('Failed to guard campaign: daily_budget_cents exceeds daily_budget_cap_cents');
  }
  if (input.objective === 'OUTCOME_SALES' && input.destination_type !== undefined) {
    throw new Error('Failed to guard campaign: OUTCOME_SALES must omit destination_type');
  }
}

/**
 * Build the inline-image field for a creative's link_data.
 *
 * Gotcha §10: the image goes inline in `link_data.picture` as the PUBLIC URL of
 * the object in the `ad-ingest` bucket; Meta fetches it at creative-create time.
 * Returns the shape the MCP boundary expects (no Meta call here).
 */
export function buildLinkDataPicture(publicUrl: string): { picture: string } {
  if (!publicUrl.startsWith('https://')) {
    throw new Error('Failed to build link_data: picture must be an https public URL');
  }
  return { picture: publicUrl };
}
