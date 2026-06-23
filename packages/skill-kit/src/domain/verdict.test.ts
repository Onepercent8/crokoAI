import { describe, expect, it } from 'vitest';
import { deriveFunnel, type FunnelInsights } from './funnel.js';
import { deriveFindings, deriveVerdict } from './verdict.js';

function funnelOf(partial: Partial<FunnelInsights>): ReturnType<typeof deriveFunnel> {
  const base: FunnelInsights = {
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
  return deriveFunnel({ ...base, ...partial });
}

describe('deriveVerdict', () => {
  it('no_data when there are no impressions and no spend', () => {
    expect(deriveVerdict({ funnel: funnelOf({}), spend_cents: 0 })).toBe('no_data');
  });

  it('learning below the impressions floor', () => {
    const funnel = funnelOf({ impressions: 100, link_clicks: 10 });
    expect(deriveVerdict({ funnel, spend_cents: 5000 })).toBe('learning');
  });

  it('underperforming when click->LPV CVR collapses with spend', () => {
    const funnel = funnelOf({ impressions: 5000, link_clicks: 200, landing_page_views: 10 });
    expect(deriveVerdict({ funnel, spend_cents: 5000 })).toBe('underperforming');
  });

  it('healthy on a strong funnel', () => {
    const funnel = funnelOf({
      impressions: 5000,
      link_clicks: 200,
      landing_page_views: 180,
      view_content: 150,
    });
    expect(deriveVerdict({ funnel, spend_cents: 5000 })).toBe('healthy');
  });
});

describe('deriveFindings', () => {
  it('flags high CTR + low LPV as a landing-page problem (>=2 metrics)', () => {
    const funnel = funnelOf({ impressions: 5000, link_clicks: 200, landing_page_views: 50 });
    const findings = deriveFindings({ funnel, spend_cents: 5000 });
    const lp = findings.find((f) => f.recommendation_type === 'landing_page');
    expect(lp).toBeDefined();
    expect(Object.keys(lp?.evidence ?? {}).length).toBeGreaterThanOrEqual(2);
  });

  it('flags weak ATC->checkout as an offer problem', () => {
    const funnel = funnelOf({
      impressions: 5000,
      link_clicks: 200,
      landing_page_views: 180,
      view_content: 150,
      add_to_cart: 100,
      initiate_checkout: 5,
    });
    const findings = deriveFindings({ funnel, spend_cents: 5000 });
    expect(findings.some((f) => f.recommendation_type === 'offer')).toBe(true);
  });

  it('returns no findings on a healthy funnel', () => {
    const funnel = funnelOf({
      impressions: 5000,
      link_clicks: 200,
      landing_page_views: 190,
      view_content: 170,
      add_to_cart: 120,
      initiate_checkout: 100,
    });
    expect(deriveFindings({ funnel, spend_cents: 5000 })).toHaveLength(0);
  });
});
