import { describe, it, expect } from 'vitest';
import { corsHeaders, isAllowedOrigin, securityHeaders } from '../src/cors.js';

describe('isAllowedOrigin', () => {
  const suffix = '.example.com';

  it('allows a subdomain of the suffix', () => {
    expect(isAllowedOrigin('https://promo.example.com', suffix)).toBe(true);
    expect(isAllowedOrigin('https://a.b.example.com', suffix)).toBe(true);
  });

  it('allows the apex domain', () => {
    expect(isAllowedOrigin('https://example.com', suffix)).toBe(true);
  });

  it('rejects a foreign domain', () => {
    expect(isAllowedOrigin('https://evil.com', suffix)).toBe(false);
    expect(isAllowedOrigin('https://example.com.evil.com', suffix)).toBe(false);
  });

  it('rejects a lookalike suffix (notexample.com)', () => {
    expect(isAllowedOrigin('https://notexample.com', suffix)).toBe(false);
  });

  it('rejects null/empty/malformed origins', () => {
    expect(isAllowedOrigin(null, suffix)).toBe(false);
    expect(isAllowedOrigin('', suffix)).toBe(false);
    expect(isAllowedOrigin('not a url', suffix)).toBe(false);
  });
});

describe('headers', () => {
  it('echoes the validated origin, never *', () => {
    const h = corsHeaders('https://promo.example.com');
    expect(h['Access-Control-Allow-Origin']).toBe('https://promo.example.com');
    expect(h['Access-Control-Allow-Origin']).not.toBe('*');
  });

  it('sets security headers', () => {
    const h = securityHeaders();
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('no-referrer');
  });
});
