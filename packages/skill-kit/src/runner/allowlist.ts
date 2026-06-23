/**
 * Skill allowlist (flyio-cron-campaign-runner §Resolução de skill).
 *
 * The job `kind` is resolved to a skill slug by a SERVER-SIDE allowlist; a slug
 * is NEVER built by concatenating free text from the job (security.md). Unknown
 * kinds throw so the job ends `failed` without executing anything.
 */

import { z } from 'zod';
import { SLUG_PATTERN } from '../domain/slug.js';

/** Job kinds the runner understands (placeholder slugs for cliente-exemplo). */
export const KIND_TO_SLUG = {
  create: 'create-traffic-cliente-exemplo-campaign',
  create_sales: 'create-sales-cliente-exemplo-campaign',
  activate: 'activate-campaign-cliente-exemplo',
  analyze: 'funnel-analytics-cliente-exemplo-campaign',
  summarize: 'daily-summary-cliente-exemplo',
  landing: 'create-landing-page-cliente-exemplo',
  landing_publish: 'publish-landing-page-cliente-exemplo',
} as const;

export type JobKind = keyof typeof KIND_TO_SLUG;

/** Kinds routed to the runner (landing_edit is synchronous in the dashboard). */
export const AgentJobKindSchema = z.enum([
  'create',
  'create_sales',
  'activate',
  'analyze',
  'summarize',
  'landing',
  'landing_publish',
  'landing_edit',
]);
export type AgentJobKind = z.infer<typeof AgentJobKindSchema>;

/** True when a kind has a runner-routed skill slug. */
export function isRoutableKind(kind: string): kind is JobKind {
  return Object.prototype.hasOwnProperty.call(KIND_TO_SLUG, kind);
}

/**
 * Resolve a job `kind` to a skill slug via the allowlist. Throws on an unknown
 * or non-routable kind (e.g. `landing_edit`). The returned slug always matches
 * the restricted slug charset (defense in depth before any on-disk path use).
 */
export function resolveKindToSlug(kind: string): string {
  if (!isRoutableKind(kind)) {
    throw new Error(`Failed to resolve skill: kind "${kind}" is not in the allowlist`);
  }
  const slug = KIND_TO_SLUG[kind];
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(`Failed to resolve skill: resolved slug has invalid charset`);
  }
  return slug;
}
