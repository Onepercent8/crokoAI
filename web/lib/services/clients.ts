import 'server-only';

import { z } from 'zod';

import { getDb } from '../db';
import type { ClientRow } from './types';

/**
 * Read service for clients (server-side, `service_role`; SPEC-000 §6).
 * Inputs are validated by Zod before hitting the database; outputs are typed.
 */

const CLIENT_COLUMNS =
  'id, slug, name, ad_account_id, default_landing_url, daily_budget_cap_cents, currency, created_at';

const slugSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes');

/** List all clients ordered by name. */
export async function listClients(): Promise<ClientRow[]> {
  const { data, error } = await getDb()
    .from('clients')
    .select(CLIENT_COLUMNS)
    .order('name', { ascending: true });
  if (error) {
    throw new Error(`Failed to list clients: ${error.message}`);
  }
  return (data ?? []) as ClientRow[];
}

/** Fetch a single client by slug, or `null` if not found. */
export async function getClientBySlug(slug: string): Promise<ClientRow | null> {
  const parsed = slugSchema.parse(slug);
  const { data, error } = await getDb()
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('slug', parsed)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to get client by slug: ${error.message}`);
  }
  return (data as ClientRow | null) ?? null;
}
