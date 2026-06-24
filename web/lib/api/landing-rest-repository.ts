import 'server-only';

import type { SectionType } from '@template/lp-render';

import { getDb } from '../db';
import type { LandingEditorRepository, SectionRow } from './landing-pages';

/**
 * Production {@link LandingEditorRepository} backed by Supabase REST +
 * `service_role` (SPEC-012; SPEC-000 §10). The browser never reads/writes these
 * tables — RLS is deny-by-default; all access flows through this server-side
 * client. NEVER the Supabase MCP.
 *
 * The optimistic UPDATE is expressed as a conditional write: it matches on
 * `(landing_page_id, type, version=expectedVersion)`. If another writer bumped
 * the version between read and write, zero rows match and we report the conflict
 * (lost-update guard), never overwriting newer content.
 */
export const supabaseLandingEditorRepository: LandingEditorRepository = {
  async getDraftStatus(landingPageId: string): Promise<string | null> {
    const { data, error } = await getDb()
      .from('landing_pages')
      .select('draft_status')
      .eq('id', landingPageId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read landing page status: ${error.message}`);
    }
    return (data as { draft_status: string } | null)?.draft_status ?? null;
  },

  async getSection(landingPageId: string, type: SectionType): Promise<SectionRow | null> {
    const { data, error } = await getDb()
      .from('landing_page_sections')
      .select('fields, version, enabled, position')
      .eq('landing_page_id', landingPageId)
      .eq('type', type)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to read landing section: ${error.message}`);
    }
    if (data === null) {
      return null;
    }
    const row = data as {
      fields: Record<string, unknown> | null;
      version: number;
      enabled: boolean;
      position: number;
    };
    return {
      fields: row.fields ?? {},
      version: row.version,
      enabled: row.enabled,
      position: row.position,
    };
  },

  async applyEdit(input): Promise<{ version: number } | null> {
    const nextVersion = input.expectedVersion + 1;
    // Conditional UPDATE: only when version still equals expectedVersion.
    const { data, error } = await getDb()
      .from('landing_page_sections')
      .update({ fields: input.fields, version: nextVersion })
      .eq('landing_page_id', input.landingPageId)
      .eq('type', input.type)
      .eq('version', input.expectedVersion)
      .select('version')
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to persist landing edit: ${error.message}`);
    }
    if (data === null) {
      // Version no longer matches → concurrent edit won the race.
      return null;
    }

    // Flip the page into the editing draft state (best-effort; the edit itself
    // already succeeded). A failure here must not undo the section write.
    const { error: pageError } = await getDb()
      .from('landing_pages')
      .update({ draft_status: 'editing' })
      .eq('id', input.landingPageId);
    if (pageError) {
      console.error(
        JSON.stringify({
          level: 'warn',
          op: 'landing.draft_status',
          message: pageError.message,
        }),
      );
    }

    return { version: (data as { version: number }).version };
  },
};
