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

// infrastructure
export * from './infrastructure/supabase-rest.js';
export * from './infrastructure/manifest-writer.js';
export * from './infrastructure/logger.js';
