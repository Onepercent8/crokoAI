'use client';

import { useState, type ReactNode } from 'react';

/**
 * PublishButton — enqueues a heavy `landing_publish` job (SPEC-012, ADR 0009).
 *
 * Publishing is NOT synchronous: the button only inserts a job into the queue
 * (`POST /api/landing-pages/:id/publish`); the runner builds and serves it. The
 * editor never executes the publish. Disabled while a publish is already in
 * flight (`publishing`).
 */
export function PublishButton({
  landingPageId,
  draftStatus,
}: {
  landingPageId: string;
  draftStatus: string;
}): ReactNode {
  const [state, setState] = useState<'idle' | 'queuing' | 'queued' | 'already' | 'error'>('idle');
  const locked = draftStatus === 'publishing' || state === 'queuing';

  async function publish(): Promise<void> {
    setState('queuing');
    try {
      const res = await fetch(`/api/landing-pages/${landingPageId}/publish`, { method: 'POST' });
      if (res.status === 202) {
        setState('queued');
      } else if (res.status === 409) {
        setState('already');
      } else {
        setState('error');
      }
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void publish()}
        disabled={locked}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        Publicar
      </button>
      {state === 'queued' && (
        <span className="text-xs text-green-600">Publicação enfileirada.</span>
      )}
      {state === 'already' && (
        <span className="text-xs text-amber-600">Já há uma publicação em andamento.</span>
      )}
      {state === 'error' && <span className="text-xs text-red-600">Falha ao enfileirar.</span>}
    </div>
  );
}
