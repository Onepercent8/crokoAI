/**
 * Manifest JSON model + pure path/serialization helpers
 * (create-traffic-campaign §Manifest JSON).
 *
 * The manifest is the forensic record of one attempt and the basis of
 * idempotency. It MUST NOT contain secrets or PII (security.md). The actual file
 * write is done in the infrastructure layer; everything here is pure.
 */

import { z } from 'zod';
import { CreativeAngleSchema } from './schemas.js';

export const MANIFEST_DIR = 'tentativas-geracao-de-campanhas';
export type ManifestKind = 'traffic';

/** One created creative + its generated image, as recorded in the manifest. */
export const ManifestCreativeSchema = z.object({
  angle: CreativeAngleSchema,
  meta_creative_id: z.string().nullable(),
  meta_ad_id: z.string().nullable(),
  generated_image_id: z.string().nullable(),
  public_url: z.string().nullable(),
});

/**
 * Manifest payload. `status` flips to "failed" with an `error` string on any
 * abort. No tokens/secrets/PII are permitted anywhere in this object.
 */
export const ManifestSchema = z.object({
  run_id: z.string().min(1),
  idempotency_key: z.string().min(8),
  kind: z.literal('traffic'),
  status: z.enum(['completed', 'failed']),
  client_slug: z.string(),
  product_slug: z.string(),
  daily_budget_cents: z.number().int().nonnegative(),
  daily_budget_cap_cents: z.number().int().nonnegative(),
  budget_was_clamped: z.boolean(),
  // Resolved brief + untrusted artefacts kept for forensics (data, not secrets).
  brief: z.record(z.unknown()).optional(),
  scrape_facts: z.record(z.unknown()).optional(),
  copies: z.array(z.record(z.unknown())).optional(),
  creatives: z.array(ManifestCreativeSchema),
  meta_campaign_id: z.string().nullable(),
  meta_ad_set_id: z.string().nullable(),
  // Supabase row ids written via REST.
  supabase_ids: z.record(z.array(z.string())).optional(),
  started_at: z.string(),
  finished_at: z.string(),
  error: z.string().optional(),
});
export type Manifest = z.infer<typeof ManifestSchema>;

/**
 * Build the manifest file name: `<stamp>-<kind>.json`.
 * The stamp is a filesystem-safe ISO timestamp (colons/dots replaced).
 */
export function manifestFileName(stampIso: string, kind: ManifestKind): string {
  const date = new Date(stampIso);
  if (Number.isNaN(date.getTime())) {
    throw new Error('Failed to build manifest name: invalid timestamp');
  }
  const safeStamp = date.toISOString().replace(/[:.]/g, '-');
  return `${safeStamp}-${kind}.json`;
}

/** Build the manifest relative path under the attempts directory. */
export function manifestRelativePath(stampIso: string, kind: ManifestKind): string {
  return `${MANIFEST_DIR}/${manifestFileName(stampIso, kind)}`;
}

/** Serialize a manifest to stable, human-readable JSON (validates first). */
export function serializeManifest(manifest: Manifest): string {
  const parsed = ManifestSchema.parse(manifest);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}
