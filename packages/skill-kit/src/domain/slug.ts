/**
 * Slug + allowlist primitives.
 *
 * SPEC-000 §10 / security.md: skill args use a restricted charset; the skill
 * name is resolved by a SERVER-SIDE allowlist BY SLUG (never free text). Scrape
 * / copy / prompt content is data, never instruction.
 */

import { z } from 'zod';

/** Restricted slug charset shared by client/product slugs and skill slugs. */
export const SLUG_PATTERN = /^[a-z0-9-]+$/;

/** Zod schema for a restricted-charset slug. */
export const SlugSchema = z
  .string()
  .min(1, 'slug must not be empty')
  .max(100, 'slug too long')
  .regex(SLUG_PATTERN, 'slug must match ^[a-z0-9-]+$');

/** True when a candidate string is a valid restricted-charset slug. */
export function isValidSlug(candidate: string): boolean {
  return SlugSchema.safeParse(candidate).success;
}

/**
 * Resolve a skill slug against a server-side allowlist.
 *
 * Returns the canonical slug when allowed, or throws. The input is treated as
 * untrusted data: it is validated for charset BEFORE the allowlist lookup so a
 * malformed value can never be used as a key elsewhere.
 */
export function resolveSkillSlug(candidate: string, allowlist: readonly string[]): string {
  const parsed = SlugSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error('Failed to resolve skill: slug has invalid charset');
  }
  const slug = parsed.data;
  if (!allowlist.includes(slug)) {
    throw new Error('Failed to resolve skill: slug not in allowlist');
  }
  return slug;
}
