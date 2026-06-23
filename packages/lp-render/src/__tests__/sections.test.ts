import { describe, it, expect } from 'vitest';
import {
  SECTION_TYPES,
  SECTION_FIELD_SCHEMAS,
  parseSectionFields,
  type SectionType,
} from '../domain/sections.js';

describe('section catalog', () => {
  it('contains exactly 17 closed section types', () => {
    expect(SECTION_TYPES).toHaveLength(17);
    expect(new Set(SECTION_TYPES).size).toBe(17);
  });

  it('has a field schema for every section type', () => {
    for (const type of SECTION_TYPES) {
      expect(SECTION_FIELD_SCHEMAS[type]).toBeDefined();
    }
  });
});

describe('per-type field validation (happy path)', () => {
  it('accepts a valid hero', () => {
    const fields = {
      headline: 'Headline',
      primaryCta: { label: 'Go', href: 'https://example.com' },
    };
    expect(() => parseSectionFields('hero', fields)).not.toThrow();
  });

  it('accepts a valid faq', () => {
    const fields = { title: 'FAQ', items: [{ question: 'q?', answer: 'a' }] };
    expect(() => parseSectionFields('faq', fields)).not.toThrow();
  });
});

describe('per-type field validation (edge cases)', () => {
  it('rejects unknown fields (closed catalog, .strict)', () => {
    const fields = {
      headline: 'Headline',
      primaryCta: { label: 'Go', href: 'https://example.com' },
      bogus: 'nope',
    };
    expect(() => parseSectionFields('hero', fields)).toThrow();
  });

  it('rejects a missing required field', () => {
    expect(() => parseSectionFields('hero', { headline: 'only' })).toThrow();
  });

  it('rejects a non-URL where a URL is required', () => {
    const fields = {
      headline: 'Headline',
      primaryCta: { label: 'Go', href: 'not-a-url' },
    };
    expect(() => parseSectionFields('hero', fields)).toThrow();
  });

  it('keeps pricing price in integer cents (rejects float)', () => {
    const fields = {
      title: 'Planos',
      plans: [
        {
          name: 'Std',
          priceCents: 197.5,
          features: ['x'],
          cta: { label: 'Buy', href: 'https://example.com' },
        },
      ],
    };
    expect(() => parseSectionFields('pricing', fields)).toThrow();
  });

  it('rejects empty arrays where at least one item is required', () => {
    expect(() => parseSectionFields('faq', { title: 'FAQ', items: [] })).toThrow();
  });

  it('rejects an invalid lead_form field name charset', () => {
    const fields = {
      title: 'Form',
      submitLabel: 'Send',
      action: 'https://example.com/submit',
      fields: [{ name: 'Bad-Name', label: 'X', type: 'text' }],
    };
    expect(() => parseSectionFields('lead_form', fields)).toThrow();
  });

  it('validates all 17 types are independently parseable for an unknown payload as failure', () => {
    for (const type of SECTION_TYPES as readonly SectionType[]) {
      const result = SECTION_FIELD_SCHEMAS[type].safeParse({ totally: 'unknown' });
      expect(result.success).toBe(false);
    }
  });
});
