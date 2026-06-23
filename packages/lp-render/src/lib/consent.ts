/**
 * Consent lib — pure state machine for visitor consent (SPEC-011).
 *
 * This is the contract used by the Wave 10 tracking layer. No I/O, no PII:
 * it only models which categories the visitor allowed. Tracking code must
 * consult `isAllowed` before emitting any event in a given category.
 */

export const CONSENT_CATEGORIES = ['necessary', 'analytics', 'marketing'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export type ConsentDecision = 'granted' | 'denied';

export interface ConsentState {
  /** Per-category decision. `necessary` is always granted. */
  readonly categories: Readonly<Record<ConsentCategory, ConsentDecision>>;
  /** Whether the visitor has made an explicit choice yet. */
  readonly decided: boolean;
}

/** Initial state: only `necessary` granted, no explicit decision made. */
export function initialConsent(): ConsentState {
  return {
    decided: false,
    categories: {
      necessary: 'granted',
      analytics: 'denied',
      marketing: 'denied',
    },
  };
}

/** Grant every optional category (explicit "accept all"). */
export function grantAll(): ConsentState {
  return {
    decided: true,
    categories: {
      necessary: 'granted',
      analytics: 'granted',
      marketing: 'granted',
    },
  };
}

/** Deny every optional category (explicit "reject all"). `necessary` stays granted. */
export function denyAll(): ConsentState {
  return {
    decided: true,
    categories: {
      necessary: 'granted',
      analytics: 'denied',
      marketing: 'denied',
    },
  };
}

/**
 * Apply a partial set of category decisions on top of an existing state.
 * `necessary` can never be denied. Returns a new immutable state and marks the
 * decision as made. Does not mutate the input.
 */
export function updateConsent(
  state: ConsentState,
  changes: Partial<Record<ConsentCategory, ConsentDecision>>,
): ConsentState {
  const next: Record<ConsentCategory, ConsentDecision> = { ...state.categories };
  for (const category of CONSENT_CATEGORIES) {
    const decision = changes[category];
    if (decision === undefined) continue;
    next[category] = category === 'necessary' ? 'granted' : decision;
  }
  return { decided: true, categories: next };
}

/** True when the given category is allowed under the current state. */
export function isAllowed(state: ConsentState, category: ConsentCategory): boolean {
  return state.categories[category] === 'granted';
}
