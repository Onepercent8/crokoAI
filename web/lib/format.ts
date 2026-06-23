/**
 * Display formatting helpers (SPEC-000 §6/§10 invariants).
 *
 * Money is ALWAYS stored as integer cents. The UI never recomputes in float; it
 * only formats the integer for display, keeping the integer as the source of
 * truth. Meta external IDs are text and shown verbatim.
 */

/**
 * Format an integer amount in cents as a localized currency string.
 * @param cents integer amount in the smallest currency unit (e.g. centavos)
 * @param currency ISO 4217 code (e.g. "BRL")
 * @param locale BCP 47 locale (defaults to pt-BR)
 */
export function formatCents(
  cents: number | null | undefined,
  currency: string,
  locale = 'pt-BR',
): string {
  if (cents === null || cents === undefined) {
    return '—';
  }
  // Convert cents -> major units for the Intl formatter without float math drift
  // on the integer itself: division happens only at the presentation boundary.
  const major = cents / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(major);
}

/** Format an integer count with locale grouping; `—` for null/undefined. */
export function formatCount(value: number | null | undefined, locale = 'pt-BR'): string {
  if (value === null || value === undefined) {
    return '—';
  }
  return new Intl.NumberFormat(locale).format(value);
}
