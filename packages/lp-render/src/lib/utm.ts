/**
 * UTM lib — normalize and propagate `utm_*` parameters onto links (SPEC-011).
 *
 * Pure: no I/O. Never invents values — only propagates what is supplied.
 * Inputs are treated as untrusted data: values are length-bounded and
 * sanitized to a restricted charset before being written to a URL.
 */

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export type UtmKey = (typeof UTM_KEYS)[number];
export type UtmParams = Partial<Record<UtmKey, string>>;

const MAX_UTM_VALUE_LENGTH = 150;
/** Allowed charset for a normalized UTM value. */
const UTM_VALUE_CHARSET = /[^a-zA-Z0-9._\- ]/g;

/**
 * Normalize a single UTM value: trim, lowercase, collapse whitespace to `_`,
 * strip disallowed characters, and bound the length. Returns `undefined` when
 * the value is empty after normalization.
 */
export function normalizeUtmValue(raw: string): string | undefined {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(UTM_VALUE_CHARSET, '')
    .slice(0, MAX_UTM_VALUE_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** Normalize an UTM bag, dropping unknown keys and empty values. */
export function normalizeUtmParams(input: Readonly<Record<string, unknown>>): UtmParams {
  const out: UtmParams = {};
  for (const key of UTM_KEYS) {
    const value = input[key];
    if (typeof value !== 'string') continue;
    const normalized = normalizeUtmValue(value);
    if (normalized !== undefined) {
      out[key] = normalized;
    }
  }
  return out;
}

/**
 * Apply UTM params onto a URL. Existing UTM params on the URL are preserved
 * unless `overwrite` is true. Returns a new URL string. Throws on invalid base.
 */
export function applyUtm(
  baseUrl: string,
  params: UtmParams,
  options: { overwrite?: boolean } = {},
): string {
  const url = new URL(baseUrl);
  const overwrite = options.overwrite ?? false;
  for (const key of UTM_KEYS) {
    const value = params[key];
    if (value === undefined) continue;
    if (!overwrite && url.searchParams.has(key)) continue;
    const normalized = normalizeUtmValue(value);
    if (normalized !== undefined) {
      url.searchParams.set(key, normalized);
    }
  }
  return url.toString();
}

/** Extract the UTM params present on a URL (normalized). */
export function extractUtm(rawUrl: string): UtmParams {
  const url = new URL(rawUrl);
  const out: UtmParams = {};
  for (const key of UTM_KEYS) {
    const value = url.searchParams.get(key);
    if (value === null) continue;
    const normalized = normalizeUtmValue(value);
    if (normalized !== undefined) {
      out[key] = normalized;
    }
  }
  return out;
}
