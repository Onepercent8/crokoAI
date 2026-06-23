import { describe, expect, it } from 'vitest';
import { resolveBudget } from './resolve-budget.js';

describe('resolveBudget', () => {
  it('uses the arg override when present', () => {
    const r = resolveBudget({
      argDailyBudgetCents: 3000,
      briefDailyBudgetCents: 1000,
      capCents: 5000,
    });
    expect(r.dailyBudgetCents).toBe(3000);
    expect(r.wasClamped).toBe(false);
  });

  it('falls back to the brief budget without an override', () => {
    const r = resolveBudget({ briefDailyBudgetCents: 2000, capCents: 5000 });
    expect(r.dailyBudgetCents).toBe(2000);
  });

  it('clamps an over-cap request down to the cap and flags it', () => {
    const r = resolveBudget({
      argDailyBudgetCents: 9000,
      briefDailyBudgetCents: 1000,
      capCents: 5000,
    });
    expect(r.dailyBudgetCents).toBe(5000);
    expect(r.requestedCents).toBe(9000);
    expect(r.wasClamped).toBe(true);
  });

  it('rejects a non-positive resolved request', () => {
    expect(() =>
      resolveBudget({ argDailyBudgetCents: 0, briefDailyBudgetCents: 0, capCents: 5000 }),
    ).toThrow(/> 0/);
  });

  it('rejects float cents', () => {
    expect(() => resolveBudget({ briefDailyBudgetCents: 10.5, capCents: 5000 })).toThrow();
  });
});
