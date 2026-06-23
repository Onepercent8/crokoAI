import 'server-only';

import { getDb } from '../db';
import {
  type AgentJobInsert,
  type InsertResult,
  isUniqueViolation,
  type JobInserter,
} from './enqueue';

/**
 * Production {@link JobInserter} backed by Supabase REST + `service_role`
 * (SPEC-016 §"Idempotência" / SPEC-000 §10 — NEVER the Supabase MCP).
 *
 * A unique-violation from the active-job partial index maps to `{conflict:true}`
 * so the caller reports `already_queued` instead of erroring.
 */
export const supabaseJobInserter: JobInserter = {
  async insert(row: AgentJobInsert): Promise<InsertResult> {
    const { data, error } = await getDb().from('agent_jobs').insert(row).select('id').single();

    if (error) {
      if (isUniqueViolation(error)) {
        return { conflict: true };
      }
      throw new Error(`Failed to enqueue agent job: ${error.message}`);
    }
    return { conflict: false, id: (data as { id: string }).id };
  },
};
