/**
 * Idempotency check (create-traffic-campaign §Idempotência).
 *
 * Defense in depth before any Meta create:
 *  1. Look for a prior `completed` manifest with the same key (cheap, local).
 *  2. (Caller) also consult `campaigns` via REST to avoid duplicate spend.
 *
 * This module is pure orchestration over injected readers, so it is testable
 * offline with mocks.
 */

import type { Manifest } from '../domain/manifest.js';

/** Reads a prior completed manifest for an idempotency key (or null). */
export type CompletedManifestReader = (idempotencyKey: string) => Promise<Manifest | null>;

/** Returns true if an active campaign already exists for the dedup scope. */
export type ActiveCampaignProbe = () => Promise<boolean>;

export interface IdempotencyDecision {
  /** When true, the skill must NOT recreate; reuse `existing`. */
  alreadyDone: boolean;
  /** The prior manifest, when found. */
  existing: Manifest | null;
  reason: 'completed-manifest' | 'active-campaign' | 'no-prior-attempt';
}

/**
 * Decide whether a create is needed. A `completed` manifest short-circuits; an
 * active campaign probe is a secondary guard against duplicate spend.
 */
export async function checkIdempotency(
  idempotencyKey: string,
  readManifest: CompletedManifestReader,
  probeActiveCampaign: ActiveCampaignProbe,
): Promise<IdempotencyDecision> {
  const existing = await readManifest(idempotencyKey);
  if (existing !== null) {
    return { alreadyDone: true, existing, reason: 'completed-manifest' };
  }
  const hasActive = await probeActiveCampaign();
  if (hasActive) {
    return { alreadyDone: true, existing: null, reason: 'active-campaign' };
  }
  return { alreadyDone: false, existing: null, reason: 'no-prior-attempt' };
}
