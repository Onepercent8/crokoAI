import { z } from 'zod';
import { safeParseContentDoc, type ContentDoc } from '../domain/content-doc.js';
import type { LandingRepository, ManifestSink, ProductRecord } from './ports.js';

/**
 * create-landing-page-<cliente> skill logic (SPEC-011, Onda 8).
 *
 * Order at the boundary: validation -> resolve product -> build draft (from the
 * IA's output, treated as untrusted data, validated by ContentDocSchema) ->
 * persist draft + sections -> enqueue `landing_publish`. Idempotent: a duplicate
 * active publish job is rejected by the DB and reported as "already queued".
 *
 * Pure application logic over injected ports — no I/O here (fully testable).
 */

const slug = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/, 'invalid slug (allowed: a-z 0-9 -)');

export const createLandingArgsSchema = z
  .object({
    client_slug: slug,
    product_slug: slug,
    subdomain: slug.optional(),
  })
  .strict();

export type CreateLandingArgs = z.infer<typeof createLandingArgsSchema>;

/**
 * Allowlist: skill slug -> publish skill name resolved server-side, never from
 * free text (SPEC-000 §10/§11). Only known clients can be published.
 */
export const PUBLISH_SKILL_BY_SLUG: Readonly<Record<string, string>> = {
  'cliente-exemplo': 'publish-landing-page-cliente-exemplo',
};

export interface CreateLandingDeps {
  repo: LandingRepository;
  manifest: ManifestSink;
  /**
   * Builds a ContentDoc from the resolved product. In production this is the
   * architect + copywriter subagents; their output is DATA, validated below.
   */
  buildContentDoc: (product: ProductRecord) => Promise<unknown>;
  /** Stable run id for correlation (agent_events.run_id semantics). */
  runId: string;
  /** Deterministic stamp for the manifest filename (e.g. ISO without colons). */
  stamp: string;
}

export interface CreateLandingResult {
  landingPageId: string;
  publishEnqueued: boolean;
  sectionCount: number;
}

function resolveSubdomain(args: CreateLandingArgs): string {
  return args.subdomain ?? `${args.client_slug}-${args.product_slug}`;
}

export async function createLandingPage(
  rawArgs: unknown,
  deps: CreateLandingDeps,
): Promise<CreateLandingResult> {
  // 1. Validation (input is data, not instruction).
  const args = createLandingArgsSchema.parse(rawArgs);

  const publishSkill = PUBLISH_SKILL_BY_SLUG[args.client_slug];
  if (publishSkill === undefined) {
    throw new Error(`Failed to create landing page: unknown client slug "${args.client_slug}"`);
  }

  // 2. Resolve product (abort before any write if absent).
  const product = await deps.repo.findProduct(args.client_slug, args.product_slug);
  if (product === null) {
    await deps.manifest.write(`${deps.stamp}-landing-create.json`, {
      runId: deps.runId,
      status: 'aborted',
      reason: 'product_not_found',
      args,
    });
    throw new Error(
      `Failed to create landing page: product "${args.product_slug}" not found for client "${args.client_slug}"`,
    );
  }

  // 3. Build the ContentDoc from the IA output, then validate (untrusted data).
  const candidate = await deps.buildContentDoc(product);
  const parsed = safeParseContentDoc(candidate);
  if (!parsed.success) {
    await deps.manifest.write(`${deps.stamp}-landing-create.json`, {
      runId: deps.runId,
      status: 'aborted',
      reason: 'invalid_content_doc',
      issues: parsed.error.issues.map((i) => ({ path: i.path, code: i.code })),
    });
    throw new Error('Failed to create landing page: generated ContentDoc failed validation');
  }
  const doc: ContentDoc = parsed.data;

  const subdomain = resolveSubdomain(args);

  // 4. Persist draft (noindex preview) + one row per section.
  const { id: landingPageId } = await deps.repo.insertLandingPage({
    id: crypto.randomUUID(),
    client_id: product.client_id,
    product_id: product.id,
    subdomain,
    noindex: true,
    status: 'draft',
    draft_status: 'ready',
    settings: doc.settings,
    theme: doc.theme,
    ...(doc.settings.priceCents !== undefined ? { price_cents: doc.settings.priceCents } : {}),
    ...(doc.settings.checkoutUrl !== undefined ? { checkout_url: doc.settings.checkoutUrl } : {}),
  });

  await deps.repo.insertSections(
    doc.sections.map((section) => ({
      landing_page_id: landingPageId,
      type: section.type,
      position: section.position,
      enabled: section.enabled,
      version: section.version,
      fields: section.fields,
    })),
  );

  await deps.repo.appendOperationLog({
    client_id: product.client_id,
    entity_type: 'landing_page',
    entity_id: landingPageId,
    action: 'create',
    actor: 'create-landing-page',
    summary: `draft created with ${doc.sections.length} sections (noindex preview)`,
  });

  // 5. Enqueue the publish job (dedup tolerated: "already queued" is not fatal).
  const { enqueued } = await deps.repo.enqueuePublishJob({
    kind: 'landing_publish',
    skill: publishSkill,
    landing_page_id: landingPageId,
    status: 'pending',
    requested_by: 'create-landing-page',
  });

  await deps.manifest.write(`${deps.stamp}-landing-create.json`, {
    runId: deps.runId,
    status: 'ok',
    landingPageId,
    subdomain,
    sectionCount: doc.sections.length,
    publishEnqueued: enqueued,
  });

  return { landingPageId, publishEnqueued: enqueued, sectionCount: doc.sections.length };
}
