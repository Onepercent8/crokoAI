import 'server-only';

import { z } from 'zod';

/**
 * Cloudflare Turnstile verification (optional anti-bot on login, ADR 0006).
 *
 * Only enforced when `CLOUDFLARE_TURNSTILE_SECRET_KEY` is configured. When no
 * secret is set, Turnstile is considered disabled and {@link isTurnstileEnabled}
 * returns false so the login flow can skip it.
 */

const VERIFY_ENDPOINT = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const turnstileResponseSchema = z.object({
  success: z.boolean(),
});

/** Whether Turnstile enforcement is active given the configured secret. */
export function isTurnstileEnabled(secret: string | undefined): boolean {
  return typeof secret === 'string' && secret.length > 0;
}

/**
 * Verify a Turnstile token against Cloudflare's siteverify endpoint.
 * Returns true only when Cloudflare confirms `success: true`.
 * @param token client-side Turnstile token (untrusted input)
 * @param secret `CLOUDFLARE_TURNSTILE_SECRET_KEY`
 * @param remoteIp optional source IP for additional validation
 */
export async function verifyTurnstile(
  token: string,
  secret: string,
  remoteIp?: string,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }
  try {
    const res = await fetch(VERIFY_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      return false;
    }
    const parsed = turnstileResponseSchema.safeParse(await res.json());
    return parsed.success && parsed.data.success;
  } catch (error) {
    // Network/parse failure: log without PII and fail closed.
    throw new Error(`Failed to verify Turnstile token: ${(error as Error).message}`);
  }
}
