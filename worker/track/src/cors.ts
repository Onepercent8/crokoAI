/**
 * Origin / CORS policy (SPEC-015 §Segurança).
 *
 * Allowlist by domain suffix (e.g. `.example.com`). The `Origin` header is not
 * an authentication primitive, but it blocks casual cross-site use and fixes
 * `Access-Control-Allow-Origin` to the validated origin (never `*`). Pure logic.
 */

/** True when `origin` is a valid https URL whose host ends in `suffix`. */
export function isAllowedOrigin(origin: string | null, suffix: string): boolean {
  if (origin === null || origin.length === 0) {
    return false;
  }
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  // Match either the apex (example.com) or any subdomain (*.example.com).
  const bare = suffix.startsWith('.') ? suffix.slice(1) : suffix;
  return host === bare || host.endsWith(`.${bare}`);
}

/** CORS headers for a validated origin. No credentials are used (no cookies). */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** Security headers applied to every response (SPEC-015 §Segurança). */
export function securityHeaders(): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  };
}
