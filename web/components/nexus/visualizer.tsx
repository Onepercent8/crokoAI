'use client';

import type { ReactNode } from 'react';

/**
 * Minimal status visualizer for the Nexus widget (SPEC-016 §"visualizer").
 * A small animated dot reflecting the pipeline state. No external deps.
 */
export function Visualizer({ status }: { status: string }): ReactNode {
  const color =
    status === 'listening'
      ? 'bg-emerald-500'
      : status === 'thinking'
        ? 'bg-amber-500'
        : status === 'speaking'
          ? 'bg-sky-500'
          : status === 'error'
            ? 'bg-red-500'
            : 'bg-zinc-400';
  const pulse = status === 'idle' || status === 'error' ? '' : 'animate-pulse';
  return (
    <span
      aria-label={`Nexus: ${status}`}
      className={`inline-block h-3 w-3 rounded-full ${color} ${pulse}`}
    />
  );
}
