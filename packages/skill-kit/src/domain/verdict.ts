/**
 * Verdict + findings domain (meta-ads-funnel-analytics §Saídas, ADR 0024).
 *
 * Pure mapping from aggregated metrics to an `overall_verdict` and from
 * cross-metric signals to `analysis_findings`. A finding crosses >=2 metrics and
 * is anchored to the objective north-star (traffic = landing_page_view volume).
 * NO I/O, NO PII.
 */

import type { FunnelEvent, FunnelStep } from './funnel.js';

export const OVERALL_VERDICTS = [
  'healthy',
  'watch',
  'underperforming',
  'learning',
  'no_data',
  'error',
] as const;
export type OverallVerdict = (typeof OVERALL_VERDICTS)[number];

export const FINDING_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export interface Finding {
  severity: FindingSeverity;
  diagnosis: string;
  /** Cross-metric evidence (>=2 metrics), NO-PII. */
  evidence: Record<string, number | null>;
  recommended_action: string;
  recommendation_type: string;
  confidence: number;
  is_significant: boolean;
}

/** Lookup a funnel step's count (0 if missing). */
function countOf(funnel: readonly FunnelEvent[], step: FunnelStep): number {
  return funnel.find((e) => e.event_type === step)?.count ?? 0;
}

/** Lookup a funnel step's CVR-from-prev (null if missing). */
function cvrPrevOf(funnel: readonly FunnelEvent[], step: FunnelStep): number | null {
  return funnel.find((e) => e.event_type === step)?.cvr_from_prev ?? null;
}

export interface VerdictInput {
  funnel: readonly FunnelEvent[];
  spend_cents: number;
  /** Learning-phase threshold: below this volume the data is not yet reliable. */
  learningImpressionsFloor?: number;
}

/**
 * Map aggregated metrics to an overall verdict.
 *
 * - no_data: zero impressions AND zero spend.
 * - learning: very low volume (below the impressions floor).
 * - underperforming: spend but the landing-page-view CVR collapsed.
 * - watch: spend, some signal, but a weak step CVR.
 * - healthy: otherwise.
 */
export function deriveVerdict(input: VerdictInput): OverallVerdict {
  const impressions = countOf(input.funnel, 'impression');
  const floor = input.learningImpressionsFloor ?? 1000;

  if (impressions === 0 && input.spend_cents === 0) {
    return 'no_data';
  }
  if (impressions < floor) {
    return 'learning';
  }
  const lpvCvr = cvrPrevOf(input.funnel, 'landing_page_view'); // click -> LPV
  const clickCvr = cvrPrevOf(input.funnel, 'link_click'); // impression -> click
  if (input.spend_cents > 0 && lpvCvr !== null && lpvCvr < 0.3) {
    return 'underperforming';
  }
  if (clickCvr !== null && clickCvr < 0.005) {
    return 'watch';
  }
  return 'healthy';
}

/**
 * Generate cross-metric findings (each crosses >=2 metrics). Empty array means
 * nothing actionable. Findings are NO-PII (only ratios/counts in `evidence`).
 */
export function deriveFindings(input: VerdictInput): Finding[] {
  const findings: Finding[] = [];
  const clickCvr = cvrPrevOf(input.funnel, 'link_click'); // CTR proxy
  const lpvCvr = cvrPrevOf(input.funnel, 'landing_page_view'); // click -> LPV
  const checkoutCvr = cvrPrevOf(input.funnel, 'initiate_checkout'); // ATC -> checkout

  // High CTR + low LPV => landing-page problem (e.g. slow load / mismatch).
  if (clickCvr !== null && clickCvr >= 0.01 && lpvCvr !== null && lpvCvr < 0.5) {
    findings.push({
      severity: 'warning',
      diagnosis: 'High click-through but low landing-page-view conversion',
      evidence: { click_cvr: clickCvr, lpv_cvr: lpvCvr },
      recommended_action: 'Investigate landing page load/relevance',
      recommendation_type: 'landing_page',
      confidence: 0.7,
      is_significant: true,
    });
  }

  // Low checkout CVR with spend => offer/price friction.
  if (input.spend_cents > 0 && checkoutCvr !== null && checkoutCvr < 0.2) {
    findings.push({
      severity: 'warning',
      diagnosis: 'Add-to-cart to checkout conversion is weak',
      evidence: { checkout_cvr: checkoutCvr, spend_cents: input.spend_cents },
      recommended_action: 'Review offer, price and checkout friction',
      recommendation_type: 'offer',
      confidence: 0.6,
      is_significant: checkoutCvr < 0.1,
    });
  }

  return findings;
}
