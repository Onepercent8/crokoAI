/**
 * Winning-creative selection (sales-campaign §Reuso, SPEC-000 §8 Onda 5).
 *
 * Pure, deterministic ranking of existing creatives by purchases over a window.
 * The sales campaign REUSES the winning `creative_id`s (never re-generates), so
 * spend is concentrated on proven performers. NO I/O here; the candidates come
 * from the read-only analytics/Meta layer.
 */

/** One existing creative + its window performance (read-only inputs). */
export interface CreativeCandidate {
  /** The Meta creative id to reuse verbatim in the new sales ad. */
  meta_creative_id: string;
  /** Purchases attributed to this creative over the window (>= 0 integer). */
  purchases: number;
  /** Purchase value in integer cents over the window (>= 0). */
  purchase_value_cents: number;
}

/**
 * Select the top-N creatives by purchases (desc), tie-broken by purchase value
 * then by id for stable, deterministic output. Candidates with zero purchases
 * are excluded — we only reuse PROVEN winners; reusing a never-converting
 * creative would not be a "winner" and risks wasted spend.
 *
 * @param candidates existing creatives with their window performance
 * @param topN how many winners to keep (must be a positive integer)
 * @throws if topN is not a positive integer, or if no winner exists (caller must
 *   decide what to do with an empty result — sales abort rather than spend blind)
 */
export function selectTopCreatives(
  candidates: readonly CreativeCandidate[],
  topN: number,
): CreativeCandidate[] {
  if (!Number.isInteger(topN) || topN <= 0) {
    throw new Error('Failed to select creatives: topN must be a positive integer');
  }
  const winners = candidates
    .filter((c) => c.purchases > 0)
    .slice()
    .sort((a, b) => {
      if (b.purchases !== a.purchases) {
        return b.purchases - a.purchases;
      }
      if (b.purchase_value_cents !== a.purchase_value_cents) {
        return b.purchase_value_cents - a.purchase_value_cents;
      }
      return a.meta_creative_id.localeCompare(b.meta_creative_id);
    });
  return winners.slice(0, topN);
}
