import 'server-only';

import { getDb } from '../db';
import {
  isLandingUniqueViolation,
  type LandingInsertResult,
  type LandingJobInsert,
  type LandingJobInserter,
} from './landing-publish';

/**
 * Production {@link LandingJobInserter} backed by Supabase REST + `service_role`
 * (SPEC-012; SPEC-000 §10 — NEVER the Supabase MCP). A unique-violation from the
 * active-job partial index maps to `{conflict:true}` so the route reports
 * `already_queued` instead of erroring.
 */
export const supabaseLandingJobInserter: LandingJobInserter = {
  async insert(row: LandingJobInsert): Promise<LandingInsertResult> {
    const { data, error } = await getDb().from('agent_jobs').insert(row).select('id').single();
    if (error) {
      if (isLandingUniqueViolation(error)) {
        return { conflict: true };
      }
      throw new Error(`Failed to enqueue landing job: ${error.message}`);
    }
    return { conflict: false, id: (data as { id: string }).id };
  },
};
