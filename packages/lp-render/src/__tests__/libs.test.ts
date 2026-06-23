import { describe, it, expect } from 'vitest';
import { normalizeUtmValue, normalizeUtmParams, applyUtm, extractUtm } from '../lib/utm.js';
import {
  isValidAffiliateCode,
  normalizeAffiliateCode,
  applyAffiliate,
  extractAffiliate,
} from '../lib/affiliate.js';
import { buildCheckoutUrl } from '../lib/checkout.js';
import { initialConsent, grantAll, denyAll, updateConsent, isAllowed } from '../lib/consent.js';

describe('utm', () => {
  it('normalizes a value (lowercase, spaces to underscore, restricted charset)', () => {
    expect(normalizeUtmValue('  Black Friday! ')).toBe('black_friday');
    expect(normalizeUtmValue('###')).toBeUndefined();
  });

  it('drops unknown keys and empty values', () => {
    const out = normalizeUtmParams({ utm_source: 'IG', foo: 'bar', utm_term: '   ' });
    expect(out).toEqual({ utm_source: 'ig' });
  });

  it('applies utm without overwriting existing params by default', () => {
    const url = applyUtm('https://example.com/?utm_source=existing', { utm_source: 'new' });
    expect(extractUtm(url).utm_source).toBe('existing');
  });

  it('overwrites when asked', () => {
    const url = applyUtm(
      'https://example.com/?utm_source=existing',
      { utm_source: 'new' },
      {
        overwrite: true,
      },
    );
    expect(extractUtm(url).utm_source).toBe('new');
  });

  it('throws on an invalid base url', () => {
    expect(() => applyUtm('not a url', { utm_source: 'x' })).toThrow();
  });
});

describe('affiliate', () => {
  it('validates the restricted charset', () => {
    expect(isValidAffiliateCode('promo_2026')).toBe(true);
    expect(isValidAffiliateCode('Bad Code')).toBe(false);
    expect(isValidAffiliateCode('a')).toBe(false); // too short
  });

  it('normalizes (trim + lowercase) when valid', () => {
    expect(normalizeAffiliateCode('  ABC-123 ')).toBe('abc-123');
    expect(normalizeAffiliateCode('!!')).toBeUndefined();
  });

  it('injects an affiliate code into a url', () => {
    const url = applyAffiliate('https://checkout.example.com/x', 'PARTNER1');
    expect(extractAffiliate(url)).toBe('partner1');
  });

  it('does not overwrite an existing affiliate param by default', () => {
    const url = applyAffiliate('https://checkout.example.com/x?aff=keep', 'other');
    expect(extractAffiliate(url)).toBe('keep');
  });

  it('throws on an invalid code', () => {
    expect(() => applyAffiliate('https://example.com', 'no!')).toThrow();
  });
});

describe('checkout', () => {
  it('composes utm + affiliate + price cents deterministically', () => {
    const a = buildCheckoutUrl('https://checkout.example.com/curso-exemplo', {
      utm: { utm_source: 'ig', utm_campaign: 'launch' },
      affiliateCode: 'partner1',
      priceCents: 19700,
    });
    const b = buildCheckoutUrl('https://checkout.example.com/curso-exemplo', {
      utm: { utm_source: 'ig', utm_campaign: 'launch' },
      affiliateCode: 'partner1',
      priceCents: 19700,
    });
    expect(a).toBe(b);
    const url = new URL(a);
    expect(url.searchParams.get('utm_source')).toBe('ig');
    expect(url.searchParams.get('aff')).toBe('partner1');
    expect(url.searchParams.get('price_cents')).toBe('19700');
  });

  it('preserves cents as integers (rejects float priceCents)', () => {
    expect(() =>
      buildCheckoutUrl('https://checkout.example.com/x', { priceCents: 197.5 }),
    ).toThrow();
  });

  it('rejects malformed extra param keys', () => {
    expect(() =>
      buildCheckoutUrl('https://checkout.example.com/x', { extra: { 'Bad Key': 'v' } }),
    ).toThrow();
  });

  it('throws on an invalid base url', () => {
    expect(() => buildCheckoutUrl('nope')).toThrow();
  });
});

describe('consent', () => {
  it('starts with only necessary granted and no decision', () => {
    const s = initialConsent();
    expect(s.decided).toBe(false);
    expect(isAllowed(s, 'necessary')).toBe(true);
    expect(isAllowed(s, 'analytics')).toBe(false);
    expect(isAllowed(s, 'marketing')).toBe(false);
  });

  it('grantAll and denyAll set the decision flag', () => {
    expect(grantAll().decided).toBe(true);
    expect(isAllowed(grantAll(), 'marketing')).toBe(true);
    expect(isAllowed(denyAll(), 'analytics')).toBe(false);
  });

  it('updateConsent never denies the necessary category', () => {
    const s = updateConsent(initialConsent(), { necessary: 'denied', analytics: 'granted' });
    expect(isAllowed(s, 'necessary')).toBe(true);
    expect(isAllowed(s, 'analytics')).toBe(true);
    expect(s.decided).toBe(true);
  });

  it('updateConsent does not mutate the input state', () => {
    const before = initialConsent();
    updateConsent(before, { analytics: 'granted' });
    expect(isAllowed(before, 'analytics')).toBe(false);
  });
});
