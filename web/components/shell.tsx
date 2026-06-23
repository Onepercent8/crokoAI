import Link from 'next/link';
import type { ReactNode } from 'react';

import { NexusWidget } from './nexus/widget';

/**
 * Minimal authenticated layout shell with primary navigation.
 * Server Component; no client-side data fetching.
 */
const NAV = [
  { href: '/', label: 'Visão geral' },
  { href: '/campaigns', label: 'Campanhas' },
  { href: '/analyses', label: 'Análises' },
  { href: '/funnel', label: 'Funil' },
  { href: '/logs', label: 'Logs' },
] as const;

export function Shell({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
        <span className="text-sm font-medium uppercase tracking-widest text-zinc-500">
          Acme · Operations
        </span>
        <nav className="flex flex-wrap gap-4 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>
      <main className="flex flex-col gap-6">{children}</main>
      <NexusWidget />
    </div>
  );
}

/** Empty-state placeholder shown when a read returns no rows (or no credentials). */
export function EmptyState({ message }: { message: string }): ReactNode {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
      {message}
    </div>
  );
}
