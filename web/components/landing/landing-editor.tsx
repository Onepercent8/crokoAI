import type { ReactNode } from 'react';

import type { LandingPageWithSections } from '@/lib/services/landing-pages';

import { LandingPreview } from './landing-preview';
import { PublishButton } from './publish-button';
import { SectionEditor } from './section-editor';

/**
 * LandingEditor — dashboard editor for one landing page (SPEC-012, Onda 9).
 *
 * Two panes: per-section forms (synchronous draft edits) and a live preview that
 * reuses the SAME React section components from `@template/lp-render` (ADR 0017,
 * single source of truth). Publishing is a separate heavy job; the button only
 * enqueues `landing_publish` — it never blocks the editor.
 *
 * Server Component shell; the per-section forms are client components.
 */
export function LandingEditor({ data }: { data: LandingPageWithSections }): ReactNode {
  const { page, sections } = data;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <div className="flex flex-col">
          <span className="text-sm text-zinc-500">{page.subdomain}</span>
          <span className="text-xs text-zinc-400">
            rascunho: {page.draft_status} · status: {page.status}
          </span>
        </div>
        <PublishButton landingPageId={page.id} draftStatus={page.draft_status} />
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Seções</h2>
          {sections.length === 0 ? (
            <p className="text-sm text-zinc-500">Nenhuma seção para editar.</p>
          ) : (
            sections.map((s) => (
              <SectionEditor
                key={s.type}
                landingPageId={page.id}
                type={s.type as Parameters<typeof SectionEditor>[0]['type']}
                fields={s.fields}
                version={s.version}
              />
            ))
          )}
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">Pré-visualização</h2>
          <LandingPreview page={page} sections={sections} />
        </div>
      </div>
    </div>
  );
}
