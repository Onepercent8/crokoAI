import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { LandingEditor } from '@/components/landing/landing-editor';
import { Shell } from '@/components/shell';
import { safeRead } from '@/lib/safe-read';
import { getLandingPageWithSections } from '@/lib/services/landing-pages';

export const dynamic = 'force-dynamic';

/**
 * Landing-page editor page (SPEC-012, Onda 9). Loads the page + its sections
 * server-side (RLS closed to the browser) and renders the per-section editor +
 * live preview. Edits are synchronous PATCHes; publish enqueues a heavy job.
 */
export default async function LandingEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  const { id } = await params;
  const { data } = await safeRead(
    'landing.getWithSections',
    () => getLandingPageWithSections(id),
    null,
  );

  if (data === null) {
    notFound();
  }

  return (
    <Shell title="Editor de landing page">
      <LandingEditor data={data} />
    </Shell>
  );
}
