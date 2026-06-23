import 'server-only';

/**
 * Password verification for the single-operator dashboard (ADR 0006).
 *
 * `DASHBOARD_PASSWORD` is a SHA-256 hex digest of the operator password (never
 * the plaintext, never stored in the DB). On login we hash the submitted
 * password and compare digests in CONSTANT TIME to avoid timing oracles.
 *
 * The Web Crypto API (`crypto.subtle`) is used so this works in the Edge runtime
 * (middleware) as well as Node, without a Node-only dependency.
 */

const encoder = new TextEncoder();

/** Compute the lowercase hex SHA-256 digest of a UTF-8 string. */
export async function sha256Hex(value: string): Promise<string> {
  const data = encoder.encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time comparison of two equal-length hex strings.
 * Returns false immediately if lengths differ (length is not a secret here).
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    // charCodeAt is safe: hex strings are ASCII; indices are bounded by length.
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verify a submitted plaintext password against the stored SHA-256 hex digest.
 * @param submitted plaintext password from the login form
 * @param storedHashHex `DASHBOARD_PASSWORD` (64-char lowercase hex)
 */
export async function verifyPassword(submitted: string, storedHashHex: string): Promise<boolean> {
  const submittedHash = await sha256Hex(submitted);
  return timingSafeEqualHex(submittedHash, storedHashHex);
}
