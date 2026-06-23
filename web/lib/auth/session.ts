import { jwtVerify, SignJWT } from 'jose';

/**
 * Stateless session for the dashboard (ADR 0006).
 *
 * The session is a signed JWT (HS256, key = `AUTH_SECRET`) carried in an
 * HttpOnly + Secure + SameSite=Strict cookie. No server-side session store: the
 * Vercel serverless runtime is stateless and `jose` runs in the Edge runtime
 * (middleware) and Node alike.
 *
 * This module is intentionally framework-agnostic (no `next/headers`) so it can
 * be unit-tested and reused by both the middleware and the Hono API.
 */

/** Cookie name carrying the session JWT. */
export const SESSION_COOKIE = 'crokoai_session';

/** Session lifetime in seconds (short-lived; ADR 0006). */
export const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

/** Subject claim used for the single operator. */
const OPERATOR_SUBJECT = 'operator';

export interface SessionClaims {
  /** Subject — always the single operator in this phase. */
  sub: string;
}

const encoder = new TextEncoder();

function key(authSecret: string): Uint8Array {
  return encoder.encode(authSecret);
}

/**
 * Issue a signed session JWT for the operator.
 * @param authSecret value of `AUTH_SECRET`
 */
export async function issueSession(authSecret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(OPERATOR_SUBJECT)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(key(authSecret));
}

/**
 * Verify a session token. Returns the claims on success, or `null` if the token
 * is missing, expired, or has an invalid signature.
 */
export async function verifySession(
  token: string | undefined | null,
  authSecret: string,
): Promise<SessionClaims | null> {
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, key(authSecret), {
      algorithms: ['HS256'],
    });
    if (payload.sub !== OPERATOR_SUBJECT) {
      return null;
    }
    return { sub: payload.sub };
  } catch {
    // Expired / tampered / malformed — treated uniformly as "no session".
    return null;
  }
}

/** Cookie attributes for the session cookie (HttpOnly/Secure/SameSite=Strict). */
export function sessionCookieOptions(): {
  httpOnly: true;
  secure: true;
  sameSite: 'strict';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };
}
