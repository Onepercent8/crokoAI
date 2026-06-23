import type { JSX } from 'react';
import type { SectionType } from '../domain/sections.js';
import { SECTION_COMPONENTS } from './sections.js';
import type { ContentSpec, ContentSpecSection } from './content-spec.js';

/**
 * LandingPage — renders a validated ContentSpec by dispatching each section to
 * its component in the closed catalog (SPEC-011). Pure, deterministic render;
 * no I/O. The `landing-pages/_template` wraps this in the Next.js page shell.
 */

/** Render one section by dispatching on its `type` (type-safe over the catalog). */
function RenderSection({ section }: { section: ContentSpecSection }): JSX.Element {
  // `as` narrows the union to the concrete component+fields pair for `type`.
  const Component = SECTION_COMPONENTS[section.type] as (props: {
    fields: ContentSpecSection['fields'];
  }) => JSX.Element;
  return <Component fields={section.fields} />;
}

export function LandingPage({ spec }: { spec: ContentSpec }): JSX.Element {
  return (
    <main className="lp-root">
      {spec.sections.map((section) => (
        <RenderSection key={section.key} section={section} />
      ))}
    </main>
  );
}

/** Section types in render order (already sorted by position) for diagnostics. */
export function sectionTypeOrder(spec: ContentSpec): SectionType[] {
  return spec.sections.map((s) => s.type);
}
