import { applyUtm, type UtmParams } from './utm.js';
import { applyAffiliate } from './affiliate.js';

/**
 * Checkout lib — build a checkout URL from a base checkout link plus tracking
 * parameters (SPEC-011). Pure: no I/O. Money stays in integer cents.
 *
 * Composition order is deterministic: UTM params first, then affiliate code,
 * so the same inputs always yield the same URL (supports idempotency).
 */

export interface CheckoutParams {
  /** UTM params to propagate onto the checkout link. */
  utm?: UtmParams;
  /** Affiliate code to inject (validated by the affiliate lib). */
  affiliateCode?: string;
  /** Affiliate query-parameter name (defaults to `aff`). */
  affiliateParam?: string;
  /** Price in integer cents, echoed for downstream reconciliation (not money math here). */
  priceCents?: number;
  /** Extra static params (restricted to string values; treated as data). */
  extra?: Readonly<Record<string, string>>;
}

const EXTRA_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const PRICE_PARAM = 'price_cents';

/**
 * Build a checkout URL. Throws `Error` when `checkoutUrl` is not a valid URL,
 * `priceCents` is not a non-negative integer, or an extra key is malformed.
 */
export function buildCheckoutUrl(checkoutUrl: string, params: CheckoutParams = {}): string {
  // Validate the base first (auth/authz is handled upstream; here: validation).
  const parsed = new URL(checkoutUrl);

  let result = parsed.toString();

  if (params.utm) {
    result = applyUtm(result, params.utm);
  }

  if (params.extra) {
    const url = new URL(result);
    for (const [key, value] of Object.entries(params.extra)) {
      if (!EXTRA_KEY_RE.test(key)) {
        throw new Error(`invalid checkout param key: ${key}`);
      }
      url.searchParams.set(key, value);
    }
    result = url.toString();
  }

  if (params.priceCents !== undefined) {
    if (!Number.isInteger(params.priceCents) || params.priceCents < 0) {
      throw new Error('priceCents must be a non-negative integer of cents');
    }
    const url = new URL(result);
    url.searchParams.set(PRICE_PARAM, String(params.priceCents));
    result = url.toString();
  }

  // Affiliate is applied last so it is never overwritten by UTM/extra handling.
  if (params.affiliateCode !== undefined) {
    const applyOptions =
      params.affiliateParam !== undefined ? { param: params.affiliateParam } : {};
    result = applyAffiliate(result, params.affiliateCode, applyOptions);
  }

  return result;
}
