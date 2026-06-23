/**
 * Next.js configuration for the dashboard (SPEC-000 Wave 6).
 *
 * Security headers are applied per-request in `middleware.ts` (CSP with a
 * per-request nonce, HSTS, etc.) rather than here, because the nonce must be
 * generated dynamically. This file keeps only build/runtime concerns.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Pin the file-tracing root to this package (the monorepo has multiple lockfiles).
  outputFileTracingRoot: import.meta.dirname,
  // `lib/db` is server-only; never bundle the Supabase secret client for the browser.
  serverExternalPackages: ['@supabase/supabase-js'],
};

export default nextConfig;
