import 'server-only';

import { z } from 'zod';

import { getDb } from '../db';

/**
 * Read service for the landing-page editor (SPEC-012; SPEC-000 §6).
 *
 * Loads a page + its sections so the dashboard can render the per-section forms.
 * Reads are server-side via `service_role` (RLS closed to the browser); the
 * editor writes go through `lib/api/landing-pages.ts` (synchronous edit path).
 */

export interface LandingPageHeader {
  id: string;
  subdomain: string;
  fqdn: string | null;
  url: string | null;
  draft_status: string;
  status: string;
  noindex: boolean;
}

export interface LandingSectionView {
  type: string;
  position: number;
  enabled: boolean;
  fields: Record<string, unknown>;
  version: number;
}

export interface LandingPageWithSections {
  page: LandingPageHeader;
  sections: LandingSectionView[];
}

const idSchema = z.string().uuid();

const PAGE_COLUMNS = 'id, subdomain, fqdn, url, draft_status, status, noindex';
const SECTION_COLUMNS = 'type, position, enabled, fields, version';

/** Load a landing page and its sections (ordered by position), or `null`. */
export async function getLandingPageWithSections(
  landingPageId: string,
): Promise<LandingPageWithSections | null> {
  const id = idSchema.parse(landingPageId);

  const { data: page, error: pageError } = await getDb()
    .from('landing_pages')
    .select(PAGE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (pageError) {
    throw new Error(`Failed to load landing page: ${pageError.message}`);
  }
  if (page === null) {
    return null;
  }

  const { data: sections, error: sectionsError } = await getDb()
    .from('landing_page_sections')
    .select(SECTION_COLUMNS)
    .eq('landing_page_id', id)
    .order('position', { ascending: true });
  if (sectionsError) {
    throw new Error(`Failed to load landing sections: ${sectionsError.message}`);
  }

  return {
    page: page as LandingPageHeader,
    sections: (
      (sections ?? []) as Array<{
        type: string;
        position: number;
        enabled: boolean;
        fields: Record<string, unknown> | null;
        version: number;
      }>
    ).map((s) => ({
      type: s.type,
      position: s.position,
      enabled: s.enabled,
      fields: s.fields ?? {},
      version: s.version,
    })),
  };
}
