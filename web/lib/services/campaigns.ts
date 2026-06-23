import 'server-only';

import { z } from 'zod';

import { getDb } from '../db';
import type { CampaignRow } from './types';

/** Read service for the Meta campaign hierarchy (top level; SPEC-000 §6). */

const CAMPAIGN_COLUMNS =
  'id, client_id, meta_campaign_id, name, objective, budget_mode, daily_budget_cents, status, created_at';

const uuidSchema = z.string().uuid();

/** List campaigns for a client (most recent first). */
export async function listCampaigns(clientId: string): Promise<CampaignRow[]> {
  const parsed = uuidSchema.parse(clientId);
  const { data, error } = await getDb()
    .from('campaigns')
    .select(CAMPAIGN_COLUMNS)
    .eq('client_id', parsed)
    .order('created_at', { ascending: false });
  if (error) {
    throw new Error(`Failed to list campaigns: ${error.message}`);
  }
  return (data ?? []) as CampaignRow[];
}
