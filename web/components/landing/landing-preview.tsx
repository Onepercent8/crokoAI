import { LandingPage, parseContentSpec } from '@template/lp-render/react';
import type { ReactNode } from 'react';

import type { LandingPageHeader, LandingSectionView } from '@/lib/services/landing-pages';

/**
 * LandingPreview — server-rendered live preview of the draft (SPEC-012).
 *
 * Reuses the SAME React section catalog the published page uses
 * (`@template/lp-render/react`), so what the operator sees here is exactly what
 * `landing-pages/_template` renders (ADR 0017). We build a content-spec from the
 * enabled sections and `parseContentSpec` validates each section's fields; an
 * invalid/incomplete draft renders a notice instead of crashing the editor.
 */
export function LandingPreview({
  page,
  sections,
}: {
  page: LandingPageHeader;
  sections: LandingSectionView[];
}): ReactNode {
  const enabled = sections.filter((s) => s.enabled);
  const rawSpec = {
    locale: 'pt' as const,
    noindex: page.noindex,
    title: page.subdomain,
    sections: enabled.map((s, index) => ({
      type: s.type,
      position: s.position,
      version: s.version,
      key: `${s.type}-${index}`,
      fields: s.fields,
    })),
  };

  let rendered: ReactNode;
  try {
    const spec = parseContentSpec(rawSpec);
    rendered = <LandingPage spec={spec} />;
  } catch {
    rendered = (
      <p className="p-4 text-sm text-amber-600">
        Rascunho incompleto: ajuste os campos das seções para ver a pré-visualização.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div className="max-h-[70vh] overflow-y-auto bg-white text-zinc-900">{rendered}</div>
    </div>
  );
}
