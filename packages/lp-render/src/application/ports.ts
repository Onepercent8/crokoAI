import type { ContentDoc } from '../domain/content-doc.js';

/**
 * Application ports for the landing-page skills (SPEC-011, Onda 8).
 *
 * The create/publish skill logic depends on these INTERFACES, never on a
 * concrete client. Production wires a REST + SUPABASE_SECRET_KEY adapter (never
 * the Supabase MCP — SPEC-000 §10); tests inject in-memory mocks. This keeps
 * the application layer pure and fully testable offline.
 *
 * Dependencies point inward (presentation -> application -> domain); the
 * Supabase/Cloudflare adapters live in `infrastructure` and implement these.
 */

/** A draft landing page persisted by the create skill. */
export interface LandingPageDraft {
  id: string;
  client_id: string;
  product_id: string;
  subdomain: string;
  noindex: boolean;
  status: 'draft';
  draft_status: 'ready';
  settings: ContentDoc['settings'];
  theme: ContentDoc['theme'];
  /** Money in integer cents, mirrored from settings for the DB column. */
  price_cents?: number;
  checkout_url?: string;
}

/** One section row persisted per ContentDoc section. */
export interface LandingPageSectionRow {
  landing_page_id: string;
  type: string;
  position: number;
  enabled: boolean;
  version: number;
  fields: unknown;
}

/** A queued publish job (kind `landing_publish`). */
export interface PublishJobRow {
  kind: 'landing_publish';
  skill: string;
  landing_page_id: string;
  status: 'pending';
  requested_by: string;
}

/** Append-only operation_logs entry (one per mutation). */
export interface OperationLogEntry {
  client_id: string;
  entity_type: 'landing_page';
  entity_id: string;
  action: 'create' | 'update';
  actor: string;
  summary: string;
}

/** Resolved product (read) the architect/copywriter build the LP from. */
export interface ProductRecord {
  id: string;
  client_id: string;
  slug: string;
  name?: string;
  brief?: unknown;
}

/**
 * Persistence port for landing pages. Implemented by a REST adapter in prod and
 * an in-memory mock in tests. All writes are headless (service_role).
 */
export interface LandingRepository {
  /** Resolve a product by client + product slug. Returns null when absent. */
  findProduct(clientSlug: string, productSlug: string): Promise<ProductRecord | null>;

  /** Insert the landing-page draft. Returns the created row's id. */
  insertLandingPage(draft: LandingPageDraft): Promise<{ id: string }>;

  /** Insert all section rows for a landing page (one per section). */
  insertSections(rows: LandingPageSectionRow[]): Promise<void>;

  /**
   * Enqueue the publish job. Returns `{ enqueued: false }` when the partial
   * unique index rejects a duplicate active job for the same (landing_page_id,
   * kind) — treated as "already queued", not a fatal error (SPEC-011 idempotency).
   */
  enqueuePublishJob(job: PublishJobRow): Promise<{ enqueued: boolean }>;

  /** Append an operation_logs row (append-only). */
  appendOperationLog(entry: OperationLogEntry): Promise<void>;

  /**
   * Read a landing page for publish: its ContentDoc plus the publish metadata
   * (subdomain, client and any existing Cloudflare project for idempotent
   * re-publish). Returns null when the landing page does not exist.
   */
  loadForPublish(landingPageId: string): Promise<LandingPublishView | null>;

  /** Update publish-time fields (status transitions, cloudflare ids, url). */
  updateLandingPagePublish(
    landingPageId: string,
    patch: {
      status?: 'building' | 'deployed' | 'failed';
      draft_status?: 'publishing';
      cloudflare_project_id?: string;
      url?: string;
      fqdn?: string;
      ssl_status?: string;
      published_snapshot?: unknown;
    },
  ): Promise<void>;
}

/** A landing page resolved for publishing (ContentDoc + publish metadata). */
export interface LandingPublishView {
  landingPageId: string;
  clientId: string;
  subdomain: string;
  doc: ContentDoc;
  /** Existing Cloudflare project to reuse on re-publish (idempotency). */
  cloudflareProjectId?: string;
}

/** Result of a deploy. Implemented by a Cloudflare Pages adapter / mock. */
export interface DeployResult {
  url: string;
  fqdn: string;
  cloudflareProjectId: string;
}

/**
 * Deployer port — serializes the ContentDoc, builds the template and deploys to
 * Cloudflare Pages. Mocked in tests (no real build/network offline).
 */
export interface LandingDeployer {
  deploy(input: {
    landingPageId: string;
    subdomain: string;
    doc: ContentDoc;
    /** Reuse an existing project for idempotent re-publish. */
    cloudflareProjectId?: string;
  }): Promise<DeployResult>;
}

/** Manifest sink (writes the per-execution manifest JSON). Mocked in tests. */
export interface ManifestSink {
  write(name: string, manifest: unknown): Promise<void>;
}
