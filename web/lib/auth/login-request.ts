import { z } from 'zod';

/**
 * Login request parsing (ADR 0006; NOTES §7 security fix).
 *
 * The login form must keep working when JavaScript has not hydrated. A native
 * <form> submit defaults to GET, which would put the password in the URL (server
 * logs, browser history, Referer). To prevent that leak the form declares
 * `method="POST"` and the endpoint accepts BOTH:
 *   - `application/json` (the hydrated client `fetch`), and
 *   - `application/x-www-form-urlencoded` (the no-JS native form submit).
 *
 * This module is framework-agnostic and pure so it can be unit-tested without an
 * HTTP server. The body is data, not instruction: it is validated by Zod before
 * any auth logic runs (`.claude/rules/security.md`).
 */

export const loginBodySchema = z.object({
  password: z.string().min(1).max(512),
  turnstileToken: z.string().max(4096).optional(),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

/** How the client expects the login result to be delivered. */
export type LoginResponseMode = 'json' | 'redirect';

/**
 * Decide whether the response should be JSON (hydrated fetch client) or an HTTP
 * redirect (no-JS native form submit). A native form submit sends
 * `application/x-www-form-urlencoded` and an `Accept` header that prefers HTML;
 * the fetch client sends `application/json`. We treat anything that is NOT json
 * as a navigation request and answer with a redirect so the browser lands on a
 * real page instead of staring at raw JSON.
 */
export function responseModeFor(contentType: string | undefined): LoginResponseMode {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('application/json')) {
    return 'json';
  }
  return 'redirect';
}

/**
 * Parse a login body from either a JSON object or URL-encoded form fields.
 * Returns the validated body or `null` if it is missing/malformed. Never throws
 * and never echoes the password.
 *
 * @param contentType the request `Content-Type` header
 * @param raw the already-read request body (JSON-parsed object, or the raw
 *   URL-encoded string for form submits)
 */
export function parseLoginBody(contentType: string | undefined, raw: unknown): LoginBody | null {
  const ct = (contentType ?? '').toLowerCase();

  let candidate: unknown = raw;
  if (ct.includes('application/x-www-form-urlencoded') && typeof raw === 'string') {
    const params = new URLSearchParams(raw);
    const password = params.get('password');
    const turnstileToken = params.get('cf-turnstile-response') ?? params.get('turnstileToken');
    candidate = {
      password: password ?? undefined,
      ...(turnstileToken !== null ? { turnstileToken } : {}),
    };
  }

  const parsed = loginBodySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
