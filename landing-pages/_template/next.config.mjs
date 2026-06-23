/**
 * Next.js config for the landing-page template (SPEC-011, Onda 8).
 *
 * `output: 'export'` produces a fully static site (no server runtime) deployed
 * to Cloudflare Pages by the publish skill. The page reads the serialized
 * artifacts (content-spec.json + theme.css) injected at build time.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: import.meta.dirname,
  images: {
    // Static export cannot use the Next image optimizer; serve images as-is.
    unoptimized: true,
  },
};

export default nextConfig;
