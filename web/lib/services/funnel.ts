import 'server-only';

import { z } from 'zod';

import { getDb } from '../db';
import type { FunnelEventRow } from './types';

/** Read service for conversion funnel events (7 steps; SPEC-000 §6). */

const FUNNEL_COLUMNS =
  'id, analysis_id, level, meta_entity_id, step_order, event_type, count, value_cents, cost_per_event_cents, cvr_from_prev, cvr_from_top';

const uuidSchema = z.string().uuid();

/** List funnel events for an analysis, ordered by step. */
export async function listFunnelEvents(analysisId: string): Promise<FunnelEventRow[]> {
  const parsed = uuidSchema.parse(analysisId);
  const { data, error } = await getDb()
    .from('funnel_events')
    .select(FUNNEL_COLUMNS)
    .eq('analysis_id', parsed)
    .order('step_order', { ascending: true });
  if (error) {
    throw new Error(`Failed to list funnel events: ${error.message}`);
  }
  return (data ?? []) as FunnelEventRow[];
}
