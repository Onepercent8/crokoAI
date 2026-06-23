import type { Kind, SkillSlug } from './schemas';

/**
 * Nexus tool registry + the server-side skill allowlist (SPEC-016 §"Allowlist").
 *
 * CRITICAL INVARIANT: the model NEVER names a skill by free text. Write tools
 * receive a `slug` from a closed set and the SERVER resolves `slug -> skill
 * name`. An unknown slug is an error (it never enqueues). This is the single
 * choke point that stops prompt-injection from running an arbitrary skill.
 *
 * This module is pure and server-only-safe (no I/O), so the mapping is unit
 * testable in isolation.
 */

/** Closed map: write-action slug -> (skill name, agent_jobs kind). */
const SKILL_BY_SLUG = {
  create: { skill: 'create-traffic-cliente-exemplo-campaign', kind: 'create' },
  sales: { skill: 'create-sales-cliente-exemplo-campaign', kind: 'create_sales' },
  activate: { skill: 'activate-cliente-exemplo', kind: 'activate' },
  analyze: { skill: 'funnel-analytics-cliente-exemplo-campaign', kind: 'analyze' },
  landing: { skill: 'create-landing-page-cliente-exemplo', kind: 'landing' },
  publish: { skill: 'publish-landing-page-cliente-exemplo', kind: 'landing_publish' },
} as const satisfies Record<SkillSlug, { skill: string; kind: Kind }>;

export interface ResolvedSkill {
  slug: SkillSlug;
  skill: string;
  kind: Kind;
}

/** Type guard: is `value` a known write-action slug? */
export function isKnownSkillSlug(value: string): value is SkillSlug {
  return Object.prototype.hasOwnProperty.call(SKILL_BY_SLUG, value);
}

/**
 * Resolve a slug to its skill name + kind via the server-side allowlist.
 * Returns `null` for any unknown slug (free text never resolves). The caller
 * MUST treat `null` as "do not enqueue".
 */
export function resolveSkill(slug: string): ResolvedSkill | null {
  if (!isKnownSkillSlug(slug)) {
    return null;
  }
  const entry = SKILL_BY_SLUG[slug];
  return { slug, skill: entry.skill, kind: entry.kind };
}

/** All allowlisted slugs (for prompt/UX listing). */
export function allowedSlugs(): SkillSlug[] {
  return Object.keys(SKILL_BY_SLUG) as SkillSlug[];
}

// --- Tool catalogue (names the chat-loop exposes to the model) ---------------

/**
 * Read tools execute directly and return pure JSON from `lib/services/*`. Write
 * tools never mutate: they return a pending action to be confirmed in a second
 * turn. The catalogue is data describing what the loop offers; the actual
 * behaviour lives in `chat-loop.ts`.
 */
export const READ_TOOLS = [
  'get_client_overview',
  'get_latest_analysis',
  'get_funnel',
  'list_campaigns',
  'get_operation_logs',
] as const;
export type ReadToolName = (typeof READ_TOOLS)[number];

export const WRITE_TOOL = 'enqueue_skill' as const;

/** Is `name` one of the read tools? */
export function isReadTool(name: string): name is ReadToolName {
  return (READ_TOOLS as readonly string[]).includes(name);
}
