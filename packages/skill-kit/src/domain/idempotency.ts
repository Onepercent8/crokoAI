/**
 * Idempotency key derivation (create-traffic-campaign §Idempotência).
 *
 * Pure, deterministic. Re-running the skill with the same key must NOT duplicate
 * a campaign or spend. Key = explicit arg OR a deterministic value derived from
 * (client_slug, product_slug, UTC day). No I/O here; the lookup against prior
 * manifests / `campaigns` happens in the application layer.
 */

import { createHash } from 'node:crypto';

const KEY_PREFIX = 'traffic';

export interface IdempotencyInput {
  client_slug: string;
  product_slug: string;
  /** A Date or ISO string; only the UTC calendar day is used. */
  at: Date | string;
}

/** Extract the UTC calendar day (YYYY-MM-DD) from a Date or ISO string. */
export function utcDay(at: Date | string): string {
  const date = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) {
    throw new Error('Failed to derive idempotency key: invalid date');
  }
  const day = date.toISOString().slice(0, 10);
  return day;
}

/**
 * Derive the deterministic idempotency key for a (client, product, UTC day).
 * Same inputs -> same key, on any machine, with no randomness.
 */
export function deriveIdempotencyKey(input: IdempotencyInput): string {
  const day = utcDay(input.at);
  const material = `${KEY_PREFIX}:${input.client_slug}:${input.product_slug}:${day}`;
  const digest = createHash('sha256').update(material).digest('hex').slice(0, 32);
  return `${KEY_PREFIX}-${day}-${digest}`;
}

/**
 * Resolve the effective idempotency key: an explicit arg wins, otherwise it is
 * derived. An explicit key shorter than 8 chars is rejected (matches the args
 * schema) so a weak key can never silently weaken dedup.
 */
export function resolveIdempotencyKey(
  explicit: string | undefined,
  input: IdempotencyInput,
): string {
  if (explicit !== undefined) {
    if (explicit.length < 8) {
      throw new Error('Failed to resolve idempotency key: explicit key too short');
    }
    return explicit;
  }
  return deriveIdempotencyKey(input);
}
