import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import './globals.css';

export const metadata: Metadata = {
  title: 'Acme — Operations Dashboard',
  description: 'Meta Ads operations dashboard (read-only).',
  robots: { index: false, follow: false },
};

/**
 * Root layout. Server Component — no secrets reach the browser; all data reads
 * happen server-side via `lib/services/*`.
 */
export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="pt-BR" className="dark">
      <head>
        {/* Croko brand fonts (Fontshare) — visual identity only. */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600&f[]=satoshi@400,500,700&display=swap"
        />
      </head>
      <body className="min-h-screen bg-white text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        {children}
      </body>
    </html>
  );
}
