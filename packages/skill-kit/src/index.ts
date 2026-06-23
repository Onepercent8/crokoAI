/**
 * @template/skill-kit — public surface.
 *
 * Pure, headless-safe runtime helpers for skills (SPEC-000 Onda 2). The Meta API
 * is NEVER called from this package; only Supabase REST persistence,
 * manifest/idempotency/operation-log helpers and Zod boundary validation.
 */

// domain
export * from './domain/money.js';
export * from './domain/slug.js';
export * from './domain/schemas.js';
export * from './domain/meta-guards.js';
export * from './domain/idempotency.js';
export * from './domain/manifest.js';
export * from './domain/operation-log.js';

// application
export * from './application/resolve-budget.js';
export * from './application/build-rows.js';
export * from './application/check-idempotency.js';
export * from './application/ports.js';
export * from './application/orchestrate-traffic.js';
// analytics (wave 4)
export * from './domain/funnel.js';
export * from './domain/verdict.js';
export * from './application/analytics-args.js';
export * from './application/orchestrate-analytics.js';
// runner (wave 3)
export * from './runner/allowlist.js';
export * from './runner/args.js';
export * from './runner/stream-events.js';

// infrastructure
export * from './infrastructure/supabase-rest.js';
export * from './infrastructure/manifest-writer.js';
export * from './infrastructure/logger.js';
