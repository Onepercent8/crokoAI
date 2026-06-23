import { z } from 'zod';

/**
 * Tracking event schema (SPEC-015 §Contratos). Every field is untrusted input
 * and is validated before any use (.claude/rules/security.md). `.strict()`
 * rejects unknown keys so a forged extra field never flows downstream.
 *
 * Money is always an integer of cents (SPEC-000 §6/§11). Never a float.
 */

export const EVENT_TYPES = [
  'page_view',
  'view_content',
  'add_to_cart',
  'initiate_checkout',
  'purchase',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const trackEventSchema = z
  .object({
    event_id: z.string().uuid(),
    event_type: z.enum(EVENT_TYPES),
    occurred_at: z.string().datetime(),
    landing_page_id: z.string().uuid(),
    utm: z
      .object({
        source: z.string().max(120).optional(),
        medium: z.string().max(120).optional(),
        campaign: z.string().max(120).optional(),
        content: z.string().max(120).optional(),
        term: z.string().max(120).optional(),
      })
      .strict()
      .optional(),
    value_cents: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    // PII accepted ONLY to be hashed for CAPI/Google and then discarded.
    // Never persisted. Presence is recorded as a boolean flag only.
    email: z.string().email().optional(),
    phone: z.string().min(5).max(20).optional(),
  })
  .strict();

export type TrackEvent = z.infer<typeof trackEventSchema>;
