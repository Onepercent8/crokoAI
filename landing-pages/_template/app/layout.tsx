import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { loadContentSpec, loadThemeCss } from '@/lib/content';
import '@template/lp-render/react/base.css';

/**
 * Root layout for a published landing page (static export).
 *
 * Theme (Croko by default) is injected as CSS custom properties from the
 * serialized theme.css; base structural CSS comes from @template/lp-render.
 * `noindex` from the content-spec drives the robots meta (preview pages are
 * never indexed until manual go-live — SPEC-000 §6).
 */

export function generateMetadata(): Metadata {
  const spec = loadContentSpec();
  return {
    title: spec.title,
    ...(spec.metaDescription !== undefined ? { description: spec.metaDescription } : {}),
    robots: spec.noindex ? { index: false, follow: false } : { index: true, follow: true },
  };
}

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  const themeCss = loadThemeCss();
  return (
    <html lang="pt-BR">
      <head>
        {/* Croko brand fonts (Fontshare) — visual identity only; text stays placeholder. */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600&f[]=satoshi@400,500,700&display=swap"
        />
        {/* Serialized theme tokens (deterministic from ContentDoc.theme). */}
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
