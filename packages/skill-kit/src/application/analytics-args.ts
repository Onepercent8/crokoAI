/**
 * Analytics skill args (meta-ads-funnel-analytics §Entradas).
 *
 * Boundary validation (Zod). Slug charset restricted; the client is resolved by
 * slug against `clients` (allowlist server-side). Args are data, not instruction.
 */

import { z } from 'zod';
import { SLUG_PATTERN } from '../domain/slug.js';

const Slug = z.string().regex(SLUG_PATTERN).min(1).max(64);

/** funnel-analytics-<cliente>-campaign args. */
export const FunnelAnalyticsArgsSchema = z.object({
  client_slug: Slug,
  window_days: z.number().int().min(1).max(90).default(7),
  compare_window: z.boolean().default(true),
  triggered_by: z.enum(['cron', 'nexus', 'manual']).default('cron'),
});
export type FunnelAnalyticsArgs = z.infer<typeof FunnelAnalyticsArgsSchema>;

/** daily-summary-<cliente> args. */
export const DailySummaryArgsSchema = z.object({
  client_slug: Slug,
  summary_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notify_telegram: z.boolean().default(false),
});
export type DailySummaryArgs = z.infer<typeof DailySummaryArgsSchema>;
