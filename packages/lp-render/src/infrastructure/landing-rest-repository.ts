import { parseContentDoc, type ContentDoc } from '../domain/content-doc.js';
import type {
  LandingPageDraft,
  LandingPageSectionRow,
  LandingPublishView,
  LandingRepository,
  OperationLogEntry,
  ProductRecord,
  PublishJobRow,
} from '../application/ports.js';

/**
 * REST adapter for LandingRepository (SPEC-011 / SPEC-000 §10).
 *
 * Headless persistence via PostgREST + SUPABASE_SECRET_KEY (service_role),
 * NEVER the Supabase MCP. RLS stays deny-by-default. `fetch` is injected so the
 * adapter is testable offline with a mock; production passes globalThis.fetch.
 * The secret key is held in memory only and never logged.
 */

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface LandingRestConfig {
  url: string;
  secretKey: string;
  fetchImpl: FetchLike;
}

export function landingRestConfigFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike,
): LandingRestConfig {
  const url = env['SUPABASE_URL'];
  const secretKey = env['SUPABASE_SECRET_KEY'];
  if (url === undefined || url.length === 0) {
    throw new Error('Failed to configure landing REST: SUPABASE_URL is not set');
  }
  if (secretKey === undefined || secretKey.length === 0) {
    throw new Error('Failed to configure landing REST: SUPABASE_SECRET_KEY is not set');
  }
  return { url, secretKey, fetchImpl };
}

function authHeaders(secretKey: string): Record<string, string> {
  return {
    apikey: secretKey,
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/json',
  };
}

function buildUrl(base: string, table: string, query?: string): string {
  const trimmed = base.replace(/\/+$/, '');
  const suffix = query !== undefined && query.length > 0 ? `?${query}` : '';
  return `${trimmed}/rest/v1/${table}${suffix}`;
}

/** Status returned by PostgREST when a unique constraint is violated. */
const CONFLICT_STATUS = 409;

export class LandingRestRepository implements LandingRepository {
  private readonly config: LandingRestConfig;

  constructor(config: LandingRestConfig) {
    this.config = config;
  }

  private async request(
    table: string,
    init: { method: string; headers?: Record<string, string>; body?: string; query?: string },
  ): Promise<{ ok: boolean; status: number; rows: unknown[] }> {
    const url = buildUrl(this.config.url, table, init.query);
    const res = await this.config.fetchImpl(url, {
      method: init.method,
      headers: { ...authHeaders(this.config.secretKey), ...init.headers },
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, rows: [] };
    }
    const parsed: unknown = await res.json();
    return { ok: true, status: res.status, rows: Array.isArray(parsed) ? parsed : [parsed] };
  }

  async findProduct(clientSlug: string, productSlug: string): Promise<ProductRecord | null> {
    // Join via client slug; PostgREST embeds the client to filter by its slug.
    const query =
      `slug=eq.${encodeURIComponent(productSlug)}` +
      `&select=id,client_id,slug,name,brief,clients!inner(slug)` +
      `&clients.slug=eq.${encodeURIComponent(clientSlug)}`;
    const res = await this.request('products', { method: 'GET', query });
    if (!res.ok) {
      throw new Error(`Failed to find product: PostgREST status ${res.status}`);
    }
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: String(row['id']),
      client_id: String(row['client_id']),
      slug: String(row['slug']),
      ...(row['name'] != null ? { name: String(row['name']) } : {}),
      ...(row['brief'] != null ? { brief: row['brief'] } : {}),
    };
  }

  async insertLandingPage(draft: LandingPageDraft): Promise<{ id: string }> {
    const res = await this.request('landing_pages', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ ...draft, raw_spec: draft }]),
    });
    if (!res.ok) {
      throw new Error(`Failed to insert landing_pages: PostgREST status ${res.status}`);
    }
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Failed to insert landing_pages: no row returned');
    }
    return { id: String(row['id']) };
  }

  async insertSections(rows: LandingPageSectionRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const res = await this.request('landing_page_sections', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      query: 'on_conflict=landing_page_id,type',
      body: JSON.stringify(rows),
    });
    if (!res.ok) {
      throw new Error(`Failed to insert landing_page_sections: PostgREST status ${res.status}`);
    }
  }

  async enqueuePublishJob(job: PublishJobRow): Promise<{ enqueued: boolean }> {
    const res = await this.request('agent_jobs', {
      method: 'POST',
      body: JSON.stringify([{ ...job, args: { landing_page_id: job.landing_page_id } }]),
    });
    if (res.ok) {
      return { enqueued: true };
    }
    // Partial unique index rejected a duplicate active job: already queued.
    if (res.status === CONFLICT_STATUS) {
      return { enqueued: false };
    }
    throw new Error(`Failed to enqueue landing_publish job: PostgREST status ${res.status}`);
  }

  async appendOperationLog(entry: OperationLogEntry): Promise<void> {
    const res = await this.request('operation_logs', {
      method: 'POST',
      body: JSON.stringify([entry]),
    });
    if (!res.ok) {
      throw new Error(`Failed to append operation_logs: PostgREST status ${res.status}`);
    }
  }

  async loadForPublish(landingPageId: string): Promise<LandingPublishView | null> {
    const lpQuery =
      `id=eq.${encodeURIComponent(landingPageId)}` +
      `&select=id,client_id,subdomain,settings,theme,cloudflare_project_id`;
    const lpRes = await this.request('landing_pages', { method: 'GET', query: lpQuery });
    if (!lpRes.ok) {
      throw new Error(`Failed to load landing page: PostgREST status ${lpRes.status}`);
    }
    const lp = lpRes.rows[0] as Record<string, unknown> | undefined;
    if (lp === undefined) {
      return null;
    }

    const secQuery =
      `landing_page_id=eq.${encodeURIComponent(landingPageId)}` +
      `&select=type,position,enabled,version,fields&order=position.asc`;
    const secRes = await this.request('landing_page_sections', { method: 'GET', query: secQuery });
    if (!secRes.ok) {
      throw new Error(`Failed to load sections: PostgREST status ${secRes.status}`);
    }

    const doc: ContentDoc = parseContentDoc({
      settings: lp['settings'],
      theme: lp['theme'],
      sections: secRes.rows,
    });

    const cfId = lp['cloudflare_project_id'];
    return {
      landingPageId: String(lp['id']),
      clientId: String(lp['client_id']),
      subdomain: String(lp['subdomain']),
      doc,
      ...(cfId != null ? { cloudflareProjectId: String(cfId) } : {}),
    };
  }

  async updateLandingPagePublish(
    landingPageId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const res = await this.request('landing_pages', {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(landingPageId)}`,
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      throw new Error(`Failed to update landing page: PostgREST status ${res.status}`);
    }
  }
}
