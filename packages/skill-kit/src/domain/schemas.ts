/**
 * Zod boundary schemas (SPEC create-traffic-campaign §Contratos).
 *
 * Every external input (skill args, product brief from the catalogue, subagent
 * outputs, scrape facts) is validated here BEFORE use. Scrape/copy/prompt are
 * untrusted data, never instructions (security.md, STRIDE Tampering).
 */

import { z } from 'zod';
import { SLUG_PATTERN } from './slug.js';

/** The three creative angles the traffic skill always produces, in order. */
export const CREATIVE_ANGLES = ['autoridade', 'dor', 'oferta'] as const;
export const CreativeAngleSchema = z.enum(CREATIVE_ANGLES);
export type CreativeAngle = z.infer<typeof CreativeAngleSchema>;

/** Image aspect ratios accepted by the image pipeline. */
export const ImageAspectSchema = z.enum(['1:1', '4:5', '1.91:1']);
export type ImageAspect = z.infer<typeof ImageAspectSchema>;

/**
 * Product brief stored at
 * `.claude/materiais-das-empresas/<cliente>/produtos/<slug>.json`.
 * Money is integer cents; objective is fixed to traffic in this wave.
 */
export const ProductBriefSchema = z.object({
  client_slug: z.string().min(1).regex(SLUG_PATTERN),
  product_slug: z.string().min(1).regex(SLUG_PATTERN),
  name: z.string().min(1),
  landing_url: z.string().url(),
  price_cents: z.number().int().nonnegative(),
  currency: z.string().length(3),
  objective: z.literal('OUTCOME_TRAFFIC'),
  call_to_action_type: z.string().min(1),
  positioning: z.string().optional(),
  pains: z.array(z.string()).optional(),
  proof: z.array(z.string()).optional(),
});
export type ProductBrief = z.infer<typeof ProductBriefSchema>;

/** Skill invocation args (restricted charset on slugs). */
export const CreateTrafficArgsSchema = z.object({
  client_slug: z.string().regex(SLUG_PATTERN),
  product_slug: z.string().regex(SLUG_PATTERN),
  // Optional override; clamped to the client cap after lookup (never above it).
  daily_budget_cents: z.number().int().positive().optional(),
  budget_mode: z.enum(['CBO', 'ABO']).default('CBO'),
  // Idempotency key; defaults to a deterministic value derived from args.
  idempotency_key: z.string().min(8).optional(),
});
export type CreateTrafficArgs = z.infer<typeof CreateTrafficArgsSchema>;

/**
 * activate-campaign args (wave 5). The target is a Meta entity id (text); only
 * the entity to flip ON is needed. Idempotency defaults to a deterministic key.
 * The entity id is treated as data: its charset is restricted so it can never be
 * abused as an instruction or path component.
 */
export const ActivateArgsSchema = z.object({
  client_slug: z.string().regex(SLUG_PATTERN),
  /** The Meta entity id to activate (campaign/ad_set/ad), restricted charset. */
  meta_entity_id: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9_:-]+$/, 'meta_entity_id has invalid charset'),
  /** What level the entity is, used only for the operation_log/audit trail. */
  entity_type: z.enum(['campaign', 'ad_set', 'ad']).default('campaign'),
  idempotency_key: z.string().min(8).optional(),
});
export type ActivateArgs = z.infer<typeof ActivateArgsSchema>;

/**
 * create-sales-campaign args (wave 5). Reuses top-N winning creatives by
 * purchases over `window_days` for an OUTCOME_SALES campaign (pixel PURCHASE).
 */
export const CreateSalesArgsSchema = z.object({
  client_slug: z.string().regex(SLUG_PATTERN),
  product_slug: z.string().regex(SLUG_PATTERN),
  // Optional override; clamped to the client cap after lookup (never above it).
  daily_budget_cents: z.number().int().positive().optional(),
  budget_mode: z.enum(['CBO', 'ABO']).default('CBO'),
  /** How many winning creatives to reuse (1..10). */
  top_n: z.number().int().positive().max(10).default(3),
  /** Lookback window for ranking winners, in days (1..90). */
  window_days: z.number().int().positive().max(90).default(14),
  idempotency_key: z.string().min(8).optional(),
});
export type CreateSalesArgs = z.infer<typeof CreateSalesArgsSchema>;

/** scrape-extractor output: landing_url -> structured facts. */
export const ScrapeFactsSchema = z.object({
  product_name: z.string(),
  promise: z.string(),
  pains: z.array(z.string()),
  proof: z.array(z.string()),
  offer: z.string(),
  cta_hint: z.string().optional(),
});
export type ScrapeFacts = z.infer<typeof ScrapeFactsSchema>;

/** copywriter output: exactly one entry per angle. */
export const CopyAngleSchema = z.object({
  angle: CreativeAngleSchema,
  headline: z.string().min(1).max(40),
  primary_text: z.string().min(1),
  description: z.string().optional(),
});
export type CopyAngle = z.infer<typeof CopyAngleSchema>;

/** copywriter output is exactly 3 angles (autoridade/dor/oferta). */
export const CopyOutputSchema = z.array(CopyAngleSchema).length(3);
export type CopyOutput = z.infer<typeof CopyOutputSchema>;

/** image-prompt-generator output: one prompt per angle. */
export const ImagePromptSchema = z.object({
  angle: CreativeAngleSchema,
  prompt: z.string().min(1),
  aspect: ImageAspectSchema.default('1:1'),
});
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;

/**
 * Assert that a copy output covers each of the three angles exactly once.
 * Length alone (CopyOutputSchema) does not guarantee distinct angles.
 */
export function assertAllAnglesCovered(copies: readonly CopyAngle[]): void {
  const seen = new Set(copies.map((c) => c.angle));
  for (const angle of CREATIVE_ANGLES) {
    if (!seen.has(angle)) {
      throw new Error(`Failed to validate copy: missing angle "${angle}"`);
    }
  }
  if (seen.size !== CREATIVE_ANGLES.length) {
    throw new Error('Failed to validate copy: duplicate angle in output');
  }
}
