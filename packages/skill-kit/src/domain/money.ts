/**
 * Money domain primitives.
 *
 * SPEC-000 §6/§10: money is ALWAYS an integer number of cents. Never floats.
 * External Meta ids are strings/text and live in a separate module.
 */

import { z } from 'zod';

/** Branded integer-cents type to make accidental float math harder. */
export type Cents = number & { readonly __brand: 'Cents' };

/** Zod schema for a non-negative integer-cents amount. */
export const CentsSchema = z
  .number()
  .int('amount must be an integer number of cents')
  .nonnegative('amount must be >= 0')
  .transform((value) => value as Cents);

/** Zod schema for a strictly positive integer-cents amount. */
export const PositiveCentsSchema = z
  .number()
  .int('amount must be an integer number of cents')
  .positive('amount must be > 0')
  .transform((value) => value as Cents);

/**
 * Narrow an arbitrary number into {@link Cents}, throwing on non-integers.
 * Use at boundaries where a value claims to already be cents.
 */
export function asCents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new Error(`Failed to read money: expected integer cents, got ${value}`);
  }
  return value as Cents;
}

/**
 * Clamp a requested daily budget to a hard cap. Both operands are integer cents.
 *
 * SPEC create-traffic-campaign §Comportamento: `daily_budget_cents = min(requested, cap)`.
 * The caller records the clamp in the manifest; this function never throws on
 * over-cap input (clamping is intentional, not an error).
 */
export function clampBudgetToCap(requested: Cents, cap: Cents): Cents {
  return (requested < cap ? requested : cap) as Cents;
}

/** True when the requested budget exceeded the cap and was clamped. */
export function wasBudgetClamped(requested: Cents, cap: Cents): boolean {
  return requested > cap;
}
