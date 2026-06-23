import { describe, it, expect } from 'vitest';
import { parseContentDoc } from '../domain/content-doc.js';
import { serialize, formatCentsBRL, ARTIFACT_NAMES } from '../domain/serializer.js';
import { validRawDoc } from './fixtures.js';

describe('formatCentsBRL', () => {
  it('formats integer cents with grouping', () => {
    expect(formatCentsBRL(19700)).toBe('197,00');
    expect(formatCentsBRL(0)).toBe('0,00');
    expect(formatCentsBRL(5)).toBe('0,05');
    expect(formatCentsBRL(123456789)).toBe('1.234.567,89');
  });

  it('throws on a float or negative input', () => {
    expect(() => formatCentsBRL(197.5)).toThrow();
    expect(() => formatCentsBRL(-1)).toThrow();
  });
});

describe('serialize', () => {
  it('produces the three named artifacts', () => {
    const doc = parseContentDoc(validRawDoc());
    const out = serialize(doc);
    expect(Object.keys(out).sort()).toEqual(
      [ARTIFACT_NAMES.messages, ARTIFACT_NAMES.contentSpec, ARTIFACT_NAMES.themeCss].sort(),
    );
  });

  it('is deterministic: same ContentDoc => identical artifacts', () => {
    const a = serialize(parseContentDoc(validRawDoc()));
    const b = serialize(parseContentDoc(validRawDoc()));
    expect(a).toEqual(b);
  });

  it('produces identical output regardless of input section order (sorted by position)', () => {
    const raw = validRawDoc();
    const reversed = { ...raw, sections: [...raw.sections].reverse() };
    const a = serialize(parseContentDoc(raw));
    const b = serialize(parseContentDoc(reversed));
    expect(a).toEqual(b);
  });

  it('emits theme.css with CSS custom properties from the Theme', () => {
    const out = serialize(parseContentDoc(validRawDoc()));
    const css = out[ARTIFACT_NAMES.themeCss];
    expect(css).toContain('--color-primary: #1d4ed8;');
    expect(css).toContain('--radius: 8px;');
    expect(css).toContain('--font-heading: Inter;');
  });

  it('exposes price both as cents and pre-formatted display', () => {
    const out = serialize(parseContentDoc(validRawDoc()));
    const spec = JSON.parse(out[ARTIFACT_NAMES.contentSpec]) as {
      priceCents: number;
      priceDisplay: string;
    };
    expect(spec.priceCents).toBe(19700);
    expect(spec.priceDisplay).toBe('197,00');
  });

  it('collects copy strings into messages and excludes disabled sections from content-spec', () => {
    const raw = validRawDoc();
    raw.sections[1]!.enabled = false; // disable faq
    const out = serialize(parseContentDoc(raw));
    const messages = JSON.parse(out[ARTIFACT_NAMES.messages]) as Record<string, string>;
    const spec = JSON.parse(out[ARTIFACT_NAMES.contentSpec]) as {
      sections: Array<{ type: string }>;
    };
    expect(messages['settings.title']).toBe('Curso Exemplo — Acme');
    expect(messages['hero.0.headline']).toContain('curso-exemplo');
    expect(spec.sections.map((s) => s.type)).not.toContain('faq');
    expect(spec.sections.map((s) => s.type)).toEqual(['hero', 'pricing']);
  });
});
