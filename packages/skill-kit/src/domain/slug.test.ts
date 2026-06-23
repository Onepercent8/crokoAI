import { describe, expect, it } from 'vitest';
import { isValidSlug, resolveSkillSlug, SlugSchema } from './slug.js';

describe('slug + allowlist', () => {
  it('accepts restricted-charset slugs', () => {
    expect(SlugSchema.parse('cliente-exemplo')).toBe('cliente-exemplo');
    expect(isValidSlug('curso-exemplo')).toBe(true);
  });

  it('rejects slugs with disallowed characters', () => {
    expect(isValidSlug('Cliente Exemplo')).toBe(false);
    expect(isValidSlug('drop;table')).toBe(false);
    expect(isValidSlug('../escape')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });

  it('resolves a slug that is in the allowlist', () => {
    const allow = ['create-traffic-cliente-exemplo-campaign', 'image-generate'];
    expect(resolveSkillSlug('image-generate', allow)).toBe('image-generate');
  });

  it('throws for a slug not in the allowlist', () => {
    expect(() => resolveSkillSlug('rogue-skill', ['image-generate'])).toThrow(/not in allowlist/);
  });

  it('throws (charset) before allowlist lookup for malformed input', () => {
    expect(() => resolveSkillSlug('image generate', ['image generate'])).toThrow(/invalid charset/);
  });
});
