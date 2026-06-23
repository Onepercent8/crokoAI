import { z } from 'zod';
import { serialize } from '../domain/serializer.js';
import type { LandingDeployer, LandingRepository, ManifestSink } from './ports.js';

/**
 * publish-landing-page-<cliente> skill logic (SPEC-011, Onda 8).
 *
 * Reads the draft ContentDoc from the DB, serializes it deterministically,
 * deploys via the injected deployer (Cloudflare Pages in prod; mock in tests),
 * and records the result. Idempotent: re-publish reuses cloudflare_project_id;
 * the same ContentDoc yields the same artifacts (serializer is deterministic).
 *
 * Pure application logic over injected ports — no I/O here.
 */

export const publishLandingArgsSchema = z
  .object({
    landing_page_id: z.string().uuid(),
  })
  .strict();

export type PublishLandingArgs = z.infer<typeof publishLandingArgsSchema>;

export interface PublishLandingDeps {
  repo: LandingRepository;
  deployer: LandingDeployer;
  manifest: ManifestSink;
  runId: string;
  stamp: string;
  /** Origin domain suffix for the preview FQDN (placeholder: example.com). */
  baseDomain?: string;
}

export interface PublishLandingResult {
  landingPageId: string;
  url: string;
  fqdn: string;
  cloudflareProjectId: string;
}

export async function publishLandingPage(
  rawArgs: unknown,
  deps: PublishLandingDeps,
): Promise<PublishLandingResult> {
  // 1. Validation.
  const args = publishLandingArgsSchema.parse(rawArgs);

  // 2. Load the draft ContentDoc + publish metadata.
  const view = await deps.repo.loadForPublish(args.landing_page_id);
  if (view === null) {
    await deps.manifest.write(`${deps.stamp}-landing-publish.json`, {
      runId: deps.runId,
      status: 'aborted',
      reason: 'landing_page_not_found',
      landingPageId: args.landing_page_id,
    });
    throw new Error(`Failed to publish landing page: ${args.landing_page_id} not found`);
  }
  const { doc } = view;

  // 3. Transition to building and serialize (deterministic artifacts).
  await deps.repo.updateLandingPagePublish(args.landing_page_id, {
    draft_status: 'publishing',
    status: 'building',
  });

  // Serialize here so a serialization failure is caught before deploy.
  serialize(doc);

  // 4. Deploy (build + Cloudflare Pages). On failure: mark failed, rethrow.
  // Reuse an existing project on re-publish so no duplicate project/subdomain.
  let result;
  try {
    result = await deps.deployer.deploy({
      landingPageId: args.landing_page_id,
      subdomain: view.subdomain,
      doc,
      ...(view.cloudflareProjectId !== undefined
        ? { cloudflareProjectId: view.cloudflareProjectId }
        : {}),
    });
  } catch (error) {
    await deps.repo.updateLandingPagePublish(args.landing_page_id, { status: 'failed' });
    await deps.manifest.write(`${deps.stamp}-landing-publish.json`, {
      runId: deps.runId,
      status: 'failed',
      reason: 'deploy_failed',
      landingPageId: args.landing_page_id,
    });
    throw new Error(`Failed to publish landing page: deploy failed: ${(error as Error).message}`);
  }

  // 5. Record success (status=deployed, cloudflare ids, url, snapshot).
  await deps.repo.updateLandingPagePublish(args.landing_page_id, {
    status: 'deployed',
    cloudflare_project_id: result.cloudflareProjectId,
    url: result.url,
    fqdn: result.fqdn,
    ssl_status: 'active',
    published_snapshot: { settings: doc.settings, sectionCount: doc.sections.length },
  });

  await deps.repo.appendOperationLog({
    client_id: view.clientId,
    entity_type: 'landing_page',
    entity_id: args.landing_page_id,
    action: 'update',
    actor: 'publish-landing-page',
    summary: `deployed to ${result.fqdn} (preview, noindex)`,
  });

  await deps.manifest.write(`${deps.stamp}-landing-publish.json`, {
    runId: deps.runId,
    status: 'ok',
    landingPageId: args.landing_page_id,
    url: result.url,
    fqdn: result.fqdn,
    cloudflareProjectId: result.cloudflareProjectId,
  });

  return {
    landingPageId: args.landing_page_id,
    url: result.url,
    fqdn: result.fqdn,
    cloudflareProjectId: result.cloudflareProjectId,
  };
}
