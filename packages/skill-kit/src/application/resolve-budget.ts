/**
 * Budget resolution (create-traffic-campaign §Comportamento step 2).
 *
 * Pure application logic: pick the requested budget (arg override or brief),
 * clamp to the client cap, and report whether clamping happened so the manifest
 * can record it. Over-cap input is clamped, NOT an error.
 */

import { asCents, clampBudgetToCap, wasBudgetClamped, type Cents } from '../domain/money.js';

export interface ResolveBudgetInput {
  /** Optional arg override (integer cents). */
  argDailyBudgetCents?: number | undefined;
  /** Fallback from the product brief (integer cents). */
  briefDailyBudgetCents: number;
  /** Hard cap from the clients row (integer cents). */
  capCents: number;
}

export interface ResolvedBudget {
  dailyBudgetCents: Cents;
  capCents: Cents;
  wasClamped: boolean;
  requestedCents: Cents;
}

/** Resolve and clamp the effective daily budget. */
export function resolveBudget(input: ResolveBudgetInput): ResolvedBudget {
  const requested = asCents(input.argDailyBudgetCents ?? input.briefDailyBudgetCents);
  const cap = asCents(input.capCents);
  if (requested <= 0) {
    throw new Error('Failed to resolve budget: requested budget must be > 0');
  }
  return {
    dailyBudgetCents: clampBudgetToCap(requested, cap),
    capCents: cap,
    wasClamped: wasBudgetClamped(requested, cap),
    requestedCents: requested,
  };
}
