import 'server-only';

import { z } from 'zod';

import { getDb } from '../db';

/**
 * Read service for `nexus_narrations` (SPEC-016 §"narrations"; SPEC-000 §6).
 *
 * The autonomous mode (Wave 9) WRITES narrations; Wave 7 only READS them for the
 * UI. Reads are server-side via `service_role` (RLS closed to the browser).
 */

export interface NarrationRow {
  id: string;
  text: string;
  kind: 'status' | 'opinion' | 'system';
  image_path: string | null;
  spoken_at: string | null;
}

const NARRATION_COLUMNS = 'id, text, kind, image_path, spoken_at';

const sessionIdSchema = z.string().min(1).max(128);

/** List narrations for a session, oldest first. */
export async function listNarrations(sessionId: string): Promise<NarrationRow[]> {
  const parsed = sessionIdSchema.parse(sessionId);
  const { data, error } = await getDb()
    .from('nexus_narrations')
    .select(NARRATION_COLUMNS)
    .eq('session_id', parsed)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to list narrations: ${error.message}`);
  }
  return (data ?? []) as NarrationRow[];
}
