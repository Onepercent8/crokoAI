/**
 * Supabase persistence via PostgREST (create-traffic-campaign §Persistência).
 *
 * Headless persistence uses REST + SUPABASE_SECRET_KEY (service_role), NEVER the
 * Supabase MCP (SPEC-000 §10). RLS stays deny-by-default; only service_role
 * reaches these tables.
 *
 * The secret is read from the environment and never logged. `fetch` is injected
 * so the client is fully testable offline with a mock.
 */

import type { OperationLogRow } from '../domain/operation-log.js';

/** Minimal fetch surface this client depends on (injectable for tests). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export interface SupabaseRestConfig {
  url: string;
  /** service_role secret key. Held in memory only; never logged. */
  secretKey: string;
  fetchImpl: FetchLike;
}

/** Resolution policy for PostgREST upserts (on-conflict merge). */
export interface UpsertOptions {
  /** Column(s) that define the conflict target, e.g. "meta_campaign_id". */
  onConflict: string;
}

/**
 * Read config from the environment (SUPABASE_URL + SUPABASE_SECRET_KEY).
 * Throws if either is missing. `fetchImpl` must be provided by the caller so the
 * client stays injectable; in production the runner passes `globalThis.fetch`.
 */
export function restConfigFromEnv(
  env: Record<string, string | undefined>,
  fetchImpl: FetchLike,
): SupabaseRestConfig {
  const url = env['SUPABASE_URL'];
  const secretKey = env['SUPABASE_SECRET_KEY'];
  if (url === undefined || url.length === 0) {
    throw new Error('Failed to configure Supabase REST: SUPABASE_URL is not set');
  }
  if (secretKey === undefined || secretKey.length === 0) {
    throw new Error('Failed to configure Supabase REST: SUPABASE_SECRET_KEY is not set');
  }
  return { url, secretKey, fetchImpl };
}

/** A table row keyed by column name. `raw_spec` is required on every upsert. */
export type TableRow = Record<string, unknown>;

function authHeaders(secretKey: string): Record<string, string> {
  // service_role secret used as both apikey and bearer (PostgREST convention).
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

/**
 * PostgREST client. Pure logic + a single injected `fetch`. All write helpers
 * return the inserted/updated rows (PostgREST `return=representation`).
 */
export class SupabaseRestClient {
  private readonly config: SupabaseRestConfig;

  constructor(config: SupabaseRestConfig) {
    this.config = config;
  }

  /**
   * Upsert one row into `table`, keeping the raw payload in `raw_spec`
   * (SPEC-000 §10: every upsert stores the raw spec as jsonb). Returns the
   * resulting row. The caller guarantees `row.raw_spec` is present.
   */
  async upsert(table: string, row: TableRow, options: UpsertOptions): Promise<TableRow> {
    if (!('raw_spec' in row)) {
      throw new Error(`Failed to upsert ${table}: row is missing raw_spec`);
    }
    const query = `on_conflict=${encodeURIComponent(options.onConflict)}`;
    const url = buildUrl(this.config.url, table, query);
    const res = await this.config.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...authHeaders(this.config.secretKey),
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([row]),
    });
    return this.firstRow(table, 'upsert', res);
  }

  /**
   * Insert append-only rows (operation_logs / agent_events). These tables reject
   * UPDATE/DELETE at the DB level; this helper only ever inserts. Returns rows.
   */
  async insertAppendOnly(table: string, rows: TableRow[]): Promise<TableRow[]> {
    if (rows.length === 0) {
      return [];
    }
    const url = buildUrl(this.config.url, table);
    const res = await this.config.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...authHeaders(this.config.secretKey),
        Prefer: 'return=representation',
      },
      body: JSON.stringify(rows),
    });
    return this.allRows(table, 'insert', res);
  }

  /** Insert exactly one append-only operation_logs row. */
  async insertOperationLog(row: OperationLogRow): Promise<TableRow> {
    const [created] = await this.insertAppendOnly('operation_logs', [row]);
    if (created === undefined) {
      throw new Error('Failed to insert operation_logs: no row returned');
    }
    return created;
  }

  /**
   * Read rows from `table` with a raw PostgREST query string (e.g. a filter on
   * client_id). Used by idempotency checks. Returns the parsed rows.
   */
  async select(table: string, query: string): Promise<TableRow[]> {
    const url = buildUrl(this.config.url, table, query);
    const res = await this.config.fetchImpl(url, {
      method: 'GET',
      headers: authHeaders(this.config.secretKey),
    });
    return this.allRows(table, 'select', res);
  }

  private async allRows(
    table: string,
    op: string,
    res: Awaited<ReturnType<FetchLike>>,
  ): Promise<TableRow[]> {
    if (!res.ok) {
      // Never include the response body verbatim (may echo input); status only.
      throw new Error(`Failed to ${op} ${table}: PostgREST status ${res.status}`);
    }
    const parsed: unknown = await res.json();
    if (!Array.isArray(parsed)) {
      throw new Error(`Failed to ${op} ${table}: expected an array response`);
    }
    return parsed as TableRow[];
  }

  private async firstRow(
    table: string,
    op: string,
    res: Awaited<ReturnType<FetchLike>>,
  ): Promise<TableRow> {
    const rows = await this.allRows(table, op, res);
    const first = rows[0];
    if (first === undefined) {
      throw new Error(`Failed to ${op} ${table}: no row returned`);
    }
    return first;
  }
}
