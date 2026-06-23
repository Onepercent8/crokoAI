import { describe, expect, it } from 'vitest';
import {
  asCents,
  CentsSchema,
  clampBudgetToCap,
  PositiveCentsSchema,
  wasBudgetClamped,
} from './money.js';

describe('money (integer cents)', () => {
  it('accepts non-negative integers', () => {
    expect(CentsSchema.parse(0)).toBe(0);
    expect(CentsSchema.parse(5000)).toBe(5000);
  });

  it('rejects floats and negatives', () => {
    expect(() => CentsSchema.parse(1.5)).toThrow();
    expect(() => CentsSchema.parse(-1)).toThrow();
    expect(() => PositiveCentsSchema.parse(0)).toThrow();
  });

  it('asCents throws on non-integers', () => {
    expect(asCents(100)).toBe(100);
    expect(() => asCents(10.1)).toThrow(/integer cents/);
  });

  it('clamps a request above the cap down to the cap', () => {
    const cap = asCents(5000);
    expect(clampBudgetToCap(asCents(9000), cap)).toBe(5000);
    expect(wasBudgetClamped(asCents(9000), cap)).toBe(true);
  });

  it('leaves a request at or below the cap untouched', () => {
    const cap = asCents(5000);
    expect(clampBudgetToCap(asCents(3000), cap)).toBe(3000);
    expect(clampBudgetToCap(asCents(5000), cap)).toBe(5000);
    expect(wasBudgetClamped(asCents(3000), cap)).toBe(false);
  });
});
