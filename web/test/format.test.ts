import { describe, expect, it } from 'vitest';

import { formatCents, formatCount } from '../lib/format';

describe('formatCents', () => {
  it('formats integer cents as currency without float drift', () => {
    // 123456 cents = 1234.56
    const out = formatCents(123456, 'BRL', 'pt-BR');
    expect(out).toContain('1.234,56');
  });

  it('returns a dash for null/undefined', () => {
    expect(formatCents(null, 'BRL')).toBe('—');
    expect(formatCents(undefined, 'BRL')).toBe('—');
  });

  it('formats zero correctly', () => {
    expect(formatCents(0, 'BRL', 'pt-BR')).toContain('0,00');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1000000, 'pt-BR')).toBe('1.000.000');
  });

  it('returns a dash for null', () => {
    expect(formatCount(null)).toBe('—');
  });
});
