/**
 * @template/lp-render/skills — application + infrastructure for the landing-page
 * skills (create/publish), Onda 8.
 *
 * Separate entry from the pure-domain root and the React layer: the runner skills
 * import this; it depends only on the domain + zod (no React, no Next). All I/O
 * is behind injected ports (REST adapter in prod, mocks in tests).
 */

export {
  createLandingArgsSchema,
  createLandingPage,
  PUBLISH_SKILL_BY_SLUG,
  type CreateLandingArgs,
  type CreateLandingDeps,
  type CreateLandingResult,
} from '../application/create-landing-page.js';

export {
  publishLandingArgsSchema,
  publishLandingPage,
  type PublishLandingArgs,
  type PublishLandingDeps,
  type PublishLandingResult,
} from '../application/publish-landing-page.js';

export type {
  DeployResult,
  LandingDeployer,
  LandingPageDraft,
  LandingPageSectionRow,
  LandingPublishView,
  LandingRepository,
  ManifestSink,
  OperationLogEntry,
  ProductRecord,
  PublishJobRow,
} from '../application/ports.js';

export {
  LandingRestRepository,
  landingRestConfigFromEnv,
  type FetchLike,
  type LandingRestConfig,
} from '../infrastructure/landing-rest-repository.js';
