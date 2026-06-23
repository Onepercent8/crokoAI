/**
 * Affiliate lib — validate and inject an affiliate code into links (SPEC-011).
 *
 * Pure: no I/O. The affiliate code is untrusted input and is constrained to a
 * restricted charset (defense against injection — SPEC-000 §11).
 */

/** Default query-parameter name carrying the affiliate code. */
export const DEFAULT_AFFILIATE_PARAM = 'aff';

/** Restricted charset for an affiliate code: lowercase alnum + dash/underscore. */
const AFFILIATE_CODE_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

/** Returns true when `code` is a syntactically valid affiliate code. */
export function isValidAffiliateCode(code: string): boolean {
  return AFFILIATE_CODE_RE.test(code);
}

/**
 * Normalize a raw affiliate code (trim + lowercase). Returns the normalized
 * code when valid, otherwise `undefined`. Does not mutate input.
 */
export function normalizeAffiliateCode(raw: string): string | undefined {
  const candidate = raw.trim().toLowerCase();
  return isValidAffiliateCode(candidate) ? candidate : undefined;
}

/**
 * Inject an affiliate code into a URL under `param`. Existing value is kept
 * unless `overwrite` is true. Throws `Error` when the code is invalid or the
 * base URL cannot be parsed.
 */
export function applyAffiliate(
  baseUrl: string,
  code: string,
  options: { param?: string; overwrite?: boolean } = {},
): string {
  const param = options.param ?? DEFAULT_AFFILIATE_PARAM;
  const overwrite = options.overwrite ?? false;
  const normalized = normalizeAffiliateCode(code);
  if (normalized === undefined) {
    throw new Error('invalid affiliate code');
  }
  const url = new URL(baseUrl);
  if (overwrite || !url.searchParams.has(param)) {
    url.searchParams.set(param, normalized);
  }
  return url.toString();
}

/** Read the affiliate code present on a URL, validated. Returns `undefined` if absent/invalid. */
export function extractAffiliate(
  rawUrl: string,
  param: string = DEFAULT_AFFILIATE_PARAM,
): string | undefined {
  const value = new URL(rawUrl).searchParams.get(param);
  if (value === null) return undefined;
  return normalizeAffiliateCode(value);
}
