import { z } from 'zod';

/**
 * review-frame — capture + upload of a landing-page preview frame (SPEC-014).
 *
 * Taking a screenshot of a data-controlled URL is a classic SSRF surface
 * (ADR 0020). The SSRF guard here is the SINGLE SOURCE OF TRUTH of the host
 * allowlist for the TS side; `scripts/screenshot-page.cjs` re-validates the same
 * rule at the runner boundary (defense in depth). Both fail SAFE: any URL not
 * provably inside `*.example.com` over HTTPS is BLOCKED before navigation.
 *
 * Pure validation (`assertSafeUrl`) + an injectable capture/upload port so the
 * decision is unit-testable with no Playwright/Storage.
 */

/** Template placeholder allowlist suffix (swap with the real domain). */
export const ALLOWED_SUFFIX = '.example.com';

export class SsrfBlockedError extends Error {
  constructor(reason: string) {
    super(`ssrf: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

/** Literal IPv4 like `1.2.3.4` (covers metadata `169.254.169.254`). */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Validate a screenshot target. Returns the normalized URL string or throws
 * {@link SsrfBlockedError}. Rules (deny-by-default):
 *  - protocol MUST be https
 *  - host MUST end with the allowlist suffix
 *  - reject localhost, literal IPv4/IPv6, and any host outside the allowlist
 */
export function assertSafeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SsrfBlockedError('malformed url');
  }
  if (u.protocol !== 'https:') {
    throw new SsrfBlockedError('protocol not allowed');
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfBlockedError('localhost');
  }
  if (IPV4.test(host)) {
    throw new SsrfBlockedError('literal ipv4');
  }
  // `new URL` strips brackets from hostname; an IPv6 host contains ':'.
  if (host.includes(':') || host === '[::1]') {
    throw new SsrfBlockedError('literal ipv6');
  }
  if (!host.endsWith(ALLOWED_SUFFIX)) {
    throw new SsrfBlockedError('host outside allowlist');
  }
  return u.toString();
}

/** Is the URL safe to capture (boolean form for callers that branch)? */
export function isSafeUrl(raw: string): boolean {
  try {
    assertSafeUrl(raw);
    return true;
  } catch {
    return false;
  }
}

// --- Frame request -----------------------------------------------------------

export const FrameRequestSchema = z.object({
  watchId: z.string().uuid(),
  // Re-validated by `assertSafeUrl` before any navigation (defense in depth).
  url: z.string().url(),
});
export type FrameRequest = z.infer<typeof FrameRequestSchema>;

/** Outcome of capturing a frame (degrades safely, never throws to the caller). */
export type CaptureResult =
  | { status: 'captured'; imagePath: string }
  | { status: 'blocked'; reason: string }
  | { status: 'failed'; reason: string };

/**
 * Port that performs the actual screenshot + upload to the private `nexus-review`
 * bucket. Real impl shells out to `scripts/screenshot-page.cjs` + REST storage;
 * tests inject a fake. The port is only invoked AFTER `assertSafeUrl` passes.
 */
export interface FrameCapturePort {
  /** Capture the URL and upload it; resolve the storage path. */
  capture(input: { watchId: string; url: string }): Promise<{ imagePath: string }>;
}

/**
 * Capture a review frame: validate (SSRF) → capture+upload. Never throws; maps
 * every failure mode to a {@link CaptureResult} so the phase machine can degrade.
 */
export async function captureReviewFrame(
  port: FrameCapturePort,
  req: FrameRequest,
): Promise<CaptureResult> {
  let safeUrl: string;
  try {
    safeUrl = assertSafeUrl(req.url);
  } catch (error) {
    if (error instanceof SsrfBlockedError) {
      return { status: 'blocked', reason: error.message };
    }
    return { status: 'failed', reason: (error as Error).message };
  }
  try {
    const { imagePath } = await port.capture({ watchId: req.watchId, url: safeUrl });
    return { status: 'captured', imagePath };
  } catch (error) {
    // Capture/render/upload error → degrade to a soft failure (no throw).
    return { status: 'failed', reason: (error as Error).message };
  }
}
