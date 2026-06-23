import { NextResponse, type NextRequest } from 'next/server';

import { SESSION_COOKIE, verifySession } from './lib/auth/session';
import { applySecurityHeaders, generateNonce, NONCE_HEADER } from './lib/security-headers';

/**
 * Edge middleware for the dashboard (SPEC-000 §11, ADR 0005/0006).
 *
 * Responsibilities on EVERY request:
 *  1. Generate a per-request CSP nonce and attach security headers to the
 *     response (HSTS, CSP-by-nonce, X-Content-Type-Options, X-Frame-Options,
 *     Referrer-Policy).
 *  2. Session gate (the `auth` step): protected routes require a valid session
 *     JWT cookie. No session -> redirect to `/login` (pages) or `401` (API).
 *
 * `authz` (operator) and `validation` (Zod) happen in the handlers, after this.
 */

/** Paths reachable without a session (login page + auth endpoints + assets). */
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/logout'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const nonce = generateNonce();
  const { pathname } = req.nextUrl;

  // Propagate the nonce to the rendering layer via a forwarded request header.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set(NONCE_HEADER, nonce);

  // AUTH STEP: verify the session for non-public routes.
  // `AUTH_SECRET` is read here (Edge runtime) directly from the environment; the
  // session module is framework-agnostic so it can run on the edge.
  const authSecret = process.env.AUTH_SECRET ?? '';
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = isPublicPath(pathname) ? null : await verifySession(token, authSecret);

  if (!isPublicPath(pathname) && session === null) {
    if (isApiPath(pathname)) {
      const res = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
      applySecurityHeaders(res.headers, nonce);
      return res;
    }
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    const res = NextResponse.redirect(loginUrl);
    applySecurityHeaders(res.headers, nonce);
    return res;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  applySecurityHeaders(res.headers, nonce);
  return res;
}

export const config = {
  // Run on everything except Next internal assets and static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
