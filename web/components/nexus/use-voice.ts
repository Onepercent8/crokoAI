'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Client hook driving the Nexus voice/chat pipeline (SPEC-016 §"Comportamento").
 *
 * Flow: record audio -> POST /api/nexus/stt -> POST /api/nexus/chat. If the turn
 * proposes a write, the server returns a `pending_action`; the user confirms it
 * with a SEPARATE POST /api/nexus/confirm (two-turn confirmation — saying "yes"
 * in chat never enqueues). TTS is best-effort: on failure we keep the text.
 *
 * All identifiers/payloads are validated server-side; this hook only orchestrates
 * the HTTP calls and local UI state.
 */

export interface PendingAction {
  action_id: string;
  slug: string;
  kind: string;
  client_id: string;
  args_preview: Record<string, unknown>;
  expires_at: string;
}

export interface NexusTurn {
  role: 'user' | 'nexus';
  text: string;
}

type Status = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

function randomSessionId(): string {
  return crypto.randomUUID();
}

export function useVoice() {
  const sessionIdRef = useRef<string>(randomSessionId());
  const [status, setStatus] = useState<Status>('idle');
  const [turns, setTurns] = useState<NexusTurn[]>([]);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const addTurn = useCallback((turn: NexusTurn) => {
    setTurns((prev) => [...prev, turn]);
  }, []);

  const speak = useCallback(async (text: string): Promise<void> => {
    try {
      setStatus('speaking');
      const res = await fetch('/api/nexus/tts', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-nexus-session': sessionIdRef.current },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        return; // degrade to text-only
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      await audio.play().catch(() => undefined);
    } finally {
      setStatus('idle');
    }
  }, []);

  /** Send a text message (or transcribed speech) through the chat loop. */
  const sendMessage = useCallback(
    async (message: string): Promise<void> => {
      addTurn({ role: 'user', text: message });
      setStatus('thinking');
      try {
        const res = await fetch('/api/nexus/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session_id: sessionIdRef.current, message }),
        });
        if (!res.ok) {
          setStatus('error');
          return;
        }
        const data = (await res.json()) as {
          reply: string;
          pending_action: PendingAction | null;
        };
        if (data.reply.length > 0) {
          addTurn({ role: 'nexus', text: data.reply });
        }
        setPending(data.pending_action);
        setStatus('idle');
        if (data.reply.length > 0) {
          void speak(data.reply);
        }
      } catch {
        setStatus('error');
      }
    },
    [addTurn, speak],
  );

  /** Confirm the proposed write (the explicit second turn). */
  const confirmPending = useCallback(async (): Promise<void> => {
    if (pending === null) {
      return;
    }
    setStatus('thinking');
    try {
      const res = await fetch('/api/nexus/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionIdRef.current, action_id: pending.action_id }),
      });
      const data = (await res.json()) as { status: string };
      addTurn({ role: 'nexus', text: `Ação: ${data.status}.` });
    } finally {
      setPending(null);
      setStatus('idle');
    }
  }, [pending, addTurn]);

  const cancelPending = useCallback((): void => {
    setPending(null);
  }, []);

  return {
    sessionId: sessionIdRef.current,
    status,
    turns,
    pending,
    sendMessage,
    confirmPending,
    cancelPending,
  };
}
