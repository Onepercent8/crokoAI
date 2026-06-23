import { describe, it, expect } from 'vitest';
import { loadContentSpec, loadThemeCss } from '../lib/content.js';

/**
 * The default content artifacts must load and validate against the closed
 * catalog (SPEC-011). If the serializer or schema drift, this fails the build.
 */
describe('landing template content loader', () => {
  it('loads and validates the default content-spec', () => {
    const spec = loadContentSpec();
    expect(spec.locale).toBe('pt');
    expect(spec.noindex).toBe(true);
    expect(spec.sections.length).toBeGreaterThan(0);
    // Sections are sorted by position.
    const positions = spec.sections.map((s) => s.position);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('loads the serialized theme.css with Croko default tokens', () => {
    const css = loadThemeCss();
    expect(css).toContain('--color-primary');
    expect(css).toContain('--font-heading');
    expect(css).toContain('#0a6e75'); // Croko teal (default theme)
  });
});
