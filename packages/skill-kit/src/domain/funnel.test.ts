import { describe, expect, it } from 'vitest';
import {
  FUNNEL_STEPS,
  aggregateAccount,
  costPerEventCents,
  deriveFunnel,
  safeRatio,
  sumInsights,
  ZERO_INSIGHTS,
  type FunnelInsights,
} from './funnel.js';

const SAMPLE: FunnelInsights = {
  spend_cents: 10000,
  impressions: 1000,
  link_clicks: 100,
  landing_page_views: 80,
  view_content: 60,
  add_to_cart: 30,
  initiate_checkout: 20,
  purchases: 10,
  purchase_value_cents: 199000,
};

describe('safeRatio', () => {
  it('returns null on a zero denominator (never 0/NaN)', () => {
    expect(safeRatio(5, 0)).toBeNull();
  });
  it('computes a normal ratio', () => {
    expect(safeRatio(80, 100)).toBeCloseTo(0.8);
  });
});

describe('costPerEventCents', () => {
  it('is null when count is 0', () => {
    expect(costPerEventCents(10000, 0)).toBeNull();
  });
  it('rounds to integer cents', () => {
    expect(costPerEventCents(10000, 3)).toBe(3333);
  });
});

describe('deriveFunnel', () => {
  it('emits exactly 7 steps in canonical order', () => {
    const funnel = deriveFunnel(SAMPLE);
    expect(funnel).toHaveLength(7);
    expect(funnel.map((e) => e.event_type)).toEqual([...FUNNEL_STEPS]);
    expect(funnel.map((e) => e.step_order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('step 1 has null cvr_from_prev and null cvr_from_top', () => {
    const [first] = deriveFunnel(SAMPLE);
    expect(first?.cvr_from_prev).toBeNull();
    expect(first?.cvr_from_top).toBeNull();
  });

  it('computes cvr_from_prev and cvr_from_top numerically', () => {
    const funnel = deriveFunnel(SAMPLE);
    const click = funnel[1];
    const lpv = funnel[2];
    expect(click?.cvr_from_prev).toBeCloseTo(0.1); // 100/1000
    expect(lpv?.cvr_from_prev).toBeCloseTo(0.8); // 80/100
    expect(lpv?.cvr_from_top).toBeCloseTo(0.08); // 80/1000
  });

  it('purchase carries value_cents; non-purchase steps carry 0', () => {
    const funnel = deriveFunnel(SAMPLE);
    expect(funnel[6]?.value_cents).toBe(199000);
    expect(funnel[0]?.value_cents).toBe(0);
  });

  it('with zero impressions all downstream CVRs are null (never 0)', () => {
    const funnel = deriveFunnel({ ...ZERO_INSIGHTS });
    expect(funnel[1]?.cvr_from_prev).toBeNull();
    expect(funnel[1]?.cvr_from_top).toBeNull();
    expect(funnel.every((e) => e.count === 0)).toBe(true);
  });
});

describe('aggregation', () => {
  it('sums field-by-field', () => {
    const summed = sumInsights(SAMPLE, SAMPLE);
    expect(summed.impressions).toBe(2000);
    expect(summed.purchase_value_cents).toBe(398000);
  });
  it('aggregateAccount over many entities equals manual sum', () => {
    const acc = aggregateAccount([SAMPLE, SAMPLE, SAMPLE]);
    expect(acc.impressions).toBe(3000);
    expect(acc.spend_cents).toBe(30000);
  });
});
