import type { EventType, TrackEvent } from './schema.js';

/**
 * NO-PII derivation + PII hashing (SPEC-015 §Comportamento).
 *
 * `toLpEventRow` builds the row written to Supabase `lp_events`: it contains
 * ONLY non-PII fields (flags, utm_*, country, value_cents, currency, event_id).
 * Email/phone are NEVER copied into the row — only their presence as booleans.
 *
 * `hashIdentifier` normalizes (trim/lowercase, E.164-ish for phone) and SHA-256
 * hashes an identifier for CAPI/Google `user_data`. The hash is computed in
 * memory and discarded after fan-out; the raw value never leaves the Worker.
 */

/** The exact NO-PII shape written to `lp_events`. No PII field exists here. */
export interface LpEventRow {
  event_id: string;
  landing_page_id: string;
  event_type: EventType;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  country?: string;
  value_cents?: number;
  currency?: string;
  has_email: boolean;
  has_phone: boolean;
}

/**
 * Build the NO-PII mirror row. `country` comes from the edge geo (request.cf),
 * never from the body. value_cents stays an integer of cents.
 */
export function toLpEventRow(event: TrackEvent, country: string | undefined): LpEventRow {
  return {
    event_id: event.event_id,
    landing_page_id: event.landing_page_id,
    event_type: event.event_type,
    ...(event.utm?.source !== undefined ? { utm_source: event.utm.source } : {}),
    ...(event.utm?.medium !== undefined ? { utm_medium: event.utm.medium } : {}),
    ...(event.utm?.campaign !== undefined ? { utm_campaign: event.utm.campaign } : {}),
    ...(event.utm?.content !== undefined ? { utm_content: event.utm.content } : {}),
    ...(event.utm?.term !== undefined ? { utm_term: event.utm.term } : {}),
    ...(country !== undefined && country.length > 0 ? { country } : {}),
    ...(event.value_cents !== undefined ? { value_cents: event.value_cents } : {}),
    ...(event.currency !== undefined ? { currency: event.currency.toUpperCase() } : {}),
    has_email: event.email !== undefined,
    has_phone: event.phone !== undefined,
  };
}

/** Normalize an email for hashing: trim + lowercase. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalize a phone for hashing: strip everything but digits (E.164 digits). */
export function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

/**
 * SHA-256 hash (lowercase hex) of an already-normalized identifier, using the
 * Web Crypto API available in Workers and Node 22. Pure aside from the digest.
 */
export async function sha256Hex(normalized: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Hashed user identifiers for CAPI/Google. Contains no raw PII. */
export interface HashedUserData {
  emailSha256?: string;
  phoneSha256?: string;
}

/** Compute hashed user_data from the event. Raw PII never leaves this function. */
export async function deriveHashedUserData(event: TrackEvent): Promise<HashedUserData> {
  const out: HashedUserData = {};
  if (event.email !== undefined) {
    out.emailSha256 = await sha256Hex(normalizeEmail(event.email));
  }
  if (event.phone !== undefined) {
    out.phoneSha256 = await sha256Hex(normalizePhone(event.phone));
  }
  return out;
}
