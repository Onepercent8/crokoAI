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
 * Live Meta entity state read back BEFORE an activation (wave 5).
 *
 * The activation skill NEVER trusts its args alone: it re-reads the entity from
 * Meta and revalidates the invariants below. `daily_budget_cents` is integer
 * cents; `status` is the current effective status as reported by Meta.
 */
export interface ActivationProbe {
  /** The Meta entity id we intend to activate. */
  meta_entity_id: string;
  /** Owning ad account, as reported by Meta (must match the client). */
  ad_account_id: string;
  /** Current effective status from Meta (must be PAUSED to activate). */
  status: string;
  /** Current daily budget in integer cents (must be <= the client cap). */
  daily_budget_cents: Cents;
}

/** What the activation skill knows about the client + intended target. */
export interface ActivationContext {
  /** The ad account the client is allowed to operate (allowlist server-side). */
  client_ad_account_id: string;
  /** Hard daily cap for the client (integer cents). */
  daily_budget_cap_cents: Cents;
  /** The entity id the operator/job asked to activate (intended target). */
  intended_entity_id: string;
}

/**
 * Fail-closed revalidation BEFORE flipping a campaign on (wave 5, SPEC §8).
 *
 * Aborts (throws) on ANY doubt — this is the only write in the system that turns
 * on real spend, so every invariant must hold:
 *  - the probed entity is the one we intended to activate (no target swap);
 *  - it belongs to the correct client ad account (no cross-client activation);
 *  - it is currently PAUSED (we only ever turn ON something that is OFF);
 *  - its current daily budget is within the client cap (no over-cap spend).
 *
 * Returns void on success; throws otherwise. There is NO "force" path.
 */
export function assertActivationSafe(probe: ActivationProbe, context: ActivationContext): void {
  if (probe.meta_entity_id !== context.intended_entity_id) {
    throw new Error('Failed to guard activation: probed entity does not match intended target');
  }
  if (probe.ad_account_id !== context.client_ad_account_id) {
    throw new Error('Failed to guard activation: entity belongs to a different ad account');
  }
  if (probe.status !== CAMPAIGN_STATUS_PAUSED) {
    throw new Error(
      `Failed to guard activation: entity must be PAUSED to activate, got "${probe.status}"`,
    );
  }
  if (probe.daily_budget_cents > context.daily_budget_cap_cents) {
    throw new Error(
      'Failed to guard activation: daily_budget_cents exceeds daily_budget_cap_cents',
    );
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
