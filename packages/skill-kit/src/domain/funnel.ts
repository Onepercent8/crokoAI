/**
 * Conversion-funnel domain (meta-ads-funnel-analytics §Funil canônico, ADR 0025).
 *
 * Pure functions: derive the 7 canonical funnel steps from a Meta insights
 * payload and compute the CVRs. NO I/O, NO Meta call. Money is integer cents;
 * CVR is a 0..1 ratio and is `null` on divide-by-zero (NEVER 0/NaN).
 */

/** Canonical 7-step funnel, in order (step_order 1..7). */
export const FUNNEL_STEPS = [
  'impression',
  'link_click',
  'landing_page_view',
  'view_content',
  'add_to_cart',
  'initiate_checkout',
  'purchase',
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/**
 * Insights subset consumed to build a funnel. All counts are non-negative
 * integers; `purchase_value_cents` is integer cents (action_values × 100).
 * `spend_cents` is the entity spend over the window (integer cents).
 */
export interface FunnelInsights {
  spend_cents: number;
  impressions: number;
  link_clicks: number;
  landing_page_views: number;
  view_content: number;
  add_to_cart: number;
  initiate_checkout: number;
  purchases: number;
  /** Integer cents of purchase value (mostly the purchase step). */
  purchase_value_cents: number;
}

/** One derived funnel event row (meta-ads-funnel-analytics §Funil). */
export interface FunnelEvent {
  step_order: number;
  event_type: FunnelStep;
  /** Volume of the step (0 if absent, never null). */
  count: number;
  /** Monetary value in cents (purchase carries action_values). */
  value_cents: number;
  /** spend_cents / count (null if count = 0). */
  cost_per_event_cents: number | null;
  /** count[i] / count[i-1] (step 1 => null; div/0 => null). */
  cvr_from_prev: number | null;
  /** count[i] / count[1] (impressions; div/0 => null). */
  cvr_from_top: number | null;
}

/** Safe ratio: returns null on a zero (or non-finite) denominator. */
export function safeRatio(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  const ratio = numerator / denominator;
  return Number.isFinite(ratio) ? ratio : null;
}

/** Integer-cents cost-per-event, rounded; null when count = 0. */
export function costPerEventCents(spendCents: number, count: number): number | null {
  if (count <= 0) {
    return null;
  }
  return Math.round(spendCents / count);
}

function countFor(step: FunnelStep, i: FunnelInsights): number {
  switch (step) {
    case 'impression':
      return i.impressions;
    case 'link_click':
      return i.link_clicks;
    case 'landing_page_view':
      return i.landing_page_views;
    case 'view_content':
      return i.view_content;
    case 'add_to_cart':
      return i.add_to_cart;
    case 'initiate_checkout':
      return i.initiate_checkout;
    case 'purchase':
      return i.purchases;
  }
}

/**
 * Derive the 7 funnel events from an insights payload. Each step gets its count,
 * cost-per-event, and both CVRs. The top (impressions) anchors `cvr_from_top`.
 */
export function deriveFunnel(insights: FunnelInsights): FunnelEvent[] {
  const counts = FUNNEL_STEPS.map((step) => Math.max(0, Math.trunc(countFor(step, insights))));
  const top = counts[0] ?? 0;

  return FUNNEL_STEPS.map((step, idx) => {
    const count = counts[idx] ?? 0;
    const prev = idx === 0 ? null : (counts[idx - 1] ?? 0);
    const value_cents =
      step === 'purchase' ? Math.max(0, Math.round(insights.purchase_value_cents)) : 0;
    return {
      step_order: idx + 1,
      event_type: step,
      count,
      value_cents,
      cost_per_event_cents: costPerEventCents(insights.spend_cents, count),
      cvr_from_prev: prev === null ? null : safeRatio(count, prev),
      cvr_from_top: idx === 0 ? null : safeRatio(count, top),
    };
  });
}

/** Sum two insights payloads field-by-field (for the `account` aggregate). */
export function sumInsights(a: FunnelInsights, b: FunnelInsights): FunnelInsights {
  return {
    spend_cents: a.spend_cents + b.spend_cents,
    impressions: a.impressions + b.impressions,
    link_clicks: a.link_clicks + b.link_clicks,
    landing_page_views: a.landing_page_views + b.landing_page_views,
    view_content: a.view_content + b.view_content,
    add_to_cart: a.add_to_cart + b.add_to_cart,
    initiate_checkout: a.initiate_checkout + b.initiate_checkout,
    purchases: a.purchases + b.purchases,
    purchase_value_cents: a.purchase_value_cents + b.purchase_value_cents,
  };
}

/** A zeroed insights payload (identity for {@link sumInsights}). */
export const ZERO_INSIGHTS: FunnelInsights = {
  spend_cents: 0,
  impressions: 0,
  link_clicks: 0,
  landing_page_views: 0,
  view_content: 0,
  add_to_cart: 0,
  initiate_checkout: 0,
  purchases: 0,
  purchase_value_cents: 0,
};

/** Aggregate many entities' insights into one `account`-level payload. */
export function aggregateAccount(entities: readonly FunnelInsights[]): FunnelInsights {
  return entities.reduce<FunnelInsights>((acc, e) => sumInsights(acc, e), { ...ZERO_INSIGHTS });
}
