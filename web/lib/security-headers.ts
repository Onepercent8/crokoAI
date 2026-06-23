/**
 * Security headers + per-request CSP nonce (SPEC-000 §11, ADR 0005).
 *
 * Applied to EVERY response by `middleware.ts`. The CSP uses a per-request nonce
 * (no `unsafe-inline`); the nonce is also exposed via a request header so Server
 * Components / the App Router can attach it to inline scripts.
 *
 * Edge-runtime safe: uses Web Crypto only.
 */

/** Header used to propagate the per-request nonce to the rendering layer. */
export const NONCE_HEADER = 'x-nonce';

/** Generate a base64 nonce (128 bits) for the CSP. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

/**
 * Build the Content-Security-Policy value for a given nonce.
 * `strict-dynamic` lets the nonce'd loader pull further scripts without an
 * allowlist; styles allow the nonce (Tailwind injects a small runtime style).
 */
export function buildCsp(nonce: string): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data: blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-src https://challenges.cloudflare.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join('; ');
}

/**
 * Apply the static security headers + CSP to a Headers object (mutates in place).
 * @param headers target headers (request or response)
 * @param nonce per-request CSP nonce
 */
export function applySecurityHeaders(headers: Headers, nonce: string): void {
  headers.set('Content-Security-Policy', buildCsp(nonce));
  headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-DNS-Prefetch-Control', 'off');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}
