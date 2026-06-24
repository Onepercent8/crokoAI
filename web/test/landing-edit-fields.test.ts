import { describe, expect, it } from 'vitest';

import { centsToMajor, coerceInput, deriveLeafFields } from '../components/landing/edit-fields';

describe('deriveLeafFields: flatten section fields to editable leaves', () => {
  it('derives scalar leaves with dotted paths', () => {
    const leaves = deriveLeafFields('hero', {
      headline: 'H',
      primaryCta: { label: 'Go', href: 'https://example.com' },
    });
    const paths = leaves.map((l) => l.path);
    expect(paths).toContain('headline');
    expect(paths).toContain('primaryCta.label');
    expect(paths).toContain('primaryCta.href');
  });

  it('expands array items to indexed paths', () => {
    const leaves = deriveLeafFields('faq', {
      title: 'FAQ',
      items: [{ question: 'Q1', answer: 'A1' }],
    });
    expect(leaves.map((l) => l.path)).toContain('items.0.question');
  });

  it('flags cents fields and infers number kind', () => {
    const leaves = deriveLeafFields('offer', {
      title: 'O',
      description: 'D',
      priceCents: 9900,
      cta: { label: 'Buy', href: 'https://example.com' },
    });
    const price = leaves.find((l) => l.path === 'priceCents');
    expect(price?.kind).toBe('number');
    expect(price?.isCents).toBe(true);
  });

  it('returns [] for an unknown section type (deny-by-default)', () => {
    // @ts-expect-error — probing an invalid type at runtime
    expect(deriveLeafFields('nope', { a: 1 })).toEqual([]);
  });
});

describe('coerceInput: money is integer cents (never float)', () => {
  it('converts a major-unit currency input to integer cents', () => {
    expect(coerceInput('number', true, '99.90')).toBe(9990);
    expect(coerceInput('number', true, '100')).toBe(10000);
  });
  it('keeps a plain number unchanged when not cents', () => {
    expect(coerceInput('number', false, '3')).toBe(3);
  });
  it('parses booleans', () => {
    expect(coerceInput('boolean', false, 'true')).toBe(true);
    expect(coerceInput('boolean', false, 'off')).toBe(false);
  });
  it('passes strings through', () => {
    expect(coerceInput('string', false, 'hello')).toBe('hello');
  });
});

describe('centsToMajor', () => {
  it('formats integer cents as a 2-decimal major string', () => {
    expect(centsToMajor(9900)).toBe('99.00');
    expect(centsToMajor(12345)).toBe('123.45');
  });
});
