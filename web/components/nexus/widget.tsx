'use client';

import { useState, type FormEvent, type ReactNode } from 'react';

import { useVoice } from './use-voice';
import { Visualizer } from './visualizer';

/**
 * Nexus assistant widget (SPEC-016 §"widget").
 *
 * A docked panel: type (or, in a fuller build, speak) to Nexus. Read answers
 * appear inline; a proposed write shows a confirmation card that the operator
 * must explicitly confirm (the two-turn invariant) before anything is enqueued.
 *
 * Voice capture (mic/VAD/wake-word) is layered on top of this text path; the
 * text path keeps the widget fully usable and testable without audio.
 */
export function NexusWidget(): ReactNode {
  const { status, turns, pending, sendMessage, confirmPending, cancelPending } = useVoice();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const message = draft.trim();
    if (message.length === 0) {
      return;
    }
    setDraft('');
    await sendMessage(message);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
      >
        Nexus
      </button>
    );
  }

  return (
    <aside className="fixed bottom-6 right-6 flex w-80 flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Visualizer status={status} /> Nexus
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
        >
          Fechar
        </button>
      </div>

      <div className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
        {turns.map((turn, i) => (
          <p
            key={i}
            className={
              turn.role === 'user'
                ? 'text-zinc-900 dark:text-zinc-100'
                : 'text-zinc-600 dark:text-zinc-400'
            }
          >
            <span className="font-medium">{turn.role === 'user' ? 'Você' : 'Nexus'}:</span>{' '}
            {turn.text}
          </p>
        ))}
      </div>

      {pending !== null && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs dark:border-amber-700 dark:bg-amber-950">
          <p className="font-medium">Confirmar ação?</p>
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">
            {pending.kind} — {String(pending.args_preview.client_slug ?? '')}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void confirmPending()}
              className="rounded bg-zinc-900 px-2 py-1 text-white dark:bg-zinc-100 dark:text-zinc-900"
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={cancelPending}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Pergunte ao Nexus…"
          className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={status === 'thinking'}
          className="rounded-md bg-zinc-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          Enviar
        </button>
      </form>
    </aside>
  );
}
