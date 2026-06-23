/**
 * @template/lp-render/react — React render layer for landing pages (SPEC-011).
 *
 * Separate entry point from the pure-domain root: the runner skills import the
 * root (`@template/lp-render`) with no React dependency; the `landing-pages/_template`
 * and the dashboard editor (Onda 9) import this subpath for rendering.
 */

export {
  ContentSpecSchema,
  ContentSpecSectionSchema,
  parseContentSpec,
  type ContentSpec,
  type ContentSpecSection,
  type RawContentSpec,
} from './content-spec.js';

export { SECTION_COMPONENTS } from './sections.js';
export { LandingPage, sectionTypeOrder } from './landing-page.js';
