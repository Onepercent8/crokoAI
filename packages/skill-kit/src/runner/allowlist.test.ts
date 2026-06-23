import { describe, expect, it } from 'vitest';
import { isRoutableKind, KIND_TO_SLUG, resolveKindToSlug } from './allowlist.js';

describe('resolveKindToSlug', () => {
  it('resolves every routable kind to its allowlisted slug', () => {
    for (const [kind, slug] of Object.entries(KIND_TO_SLUG)) {
      expect(resolveKindToSlug(kind)).toBe(slug);
    }
  });

  it('rejects an unknown kind', () => {
    expect(() => resolveKindToSlug('rm -rf')).toThrow(/allowlist/);
  });

  it('rejects landing_edit (synchronous in dashboard, not runner-routed)', () => {
    expect(() => resolveKindToSlug('landing_edit')).toThrow(/allowlist/);
    expect(isRoutableKind('landing_edit')).toBe(false);
  });

  it('resolved slugs all match the restricted slug charset', () => {
    for (const slug of Object.values(KIND_TO_SLUG)) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
    }
  });
});
