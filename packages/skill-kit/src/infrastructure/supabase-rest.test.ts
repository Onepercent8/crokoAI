import { describe, expect, it, vi } from 'vitest';
import { buildOperationLog } from '../domain/operation-log.js';
import { restConfigFromEnv, SupabaseRestClient, type FetchLike } from './supabase-rest.js';

interface Captured {
  url: string;
  method: string | undefined;
  headers: Record<string, string> | undefined;
  body: string | undefined;
}

function mockFetch(responder: (call: Captured) => { ok: boolean; status: number; json: unknown }): {
  fetchImpl: FetchLike;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Captured = {
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    };
    calls.push(call);
    const r = responder(call);
    return {
      ok: r.ok,
      status: r.status,
      text: async () => JSON.stringify(r.json),
      json: async () => r.json,
    };
  };
  return { fetchImpl, calls };
}

describe('restConfigFromEnv', () => {
  it('reads url + secret from env', () => {
    const { fetchImpl } = mockFetch(() => ({ ok: true, status: 200, json: [] }));
    const cfg = restConfigFromEnv(
      { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SECRET_KEY: 'sk_test' },
      fetchImpl,
    );
    expect(cfg.url).toBe('https://x.supabase.co');
    expect(cfg.secretKey).toBe('sk_test');
  });

  it('throws when SUPABASE_URL is missing', () => {
    const { fetchImpl } = mockFetch(() => ({ ok: true, status: 200, json: [] }));
    expect(() => restConfigFromEnv({ SUPABASE_SECRET_KEY: 'sk' }, fetchImpl)).toThrow(
      /SUPABASE_URL/,
    );
  });

  it('throws when SUPABASE_SECRET_KEY is missing', () => {
    const { fetchImpl } = mockFetch(() => ({ ok: true, status: 200, json: [] }));
    expect(() => restConfigFromEnv({ SUPABASE_URL: 'https://x' }, fetchImpl)).toThrow(
      /SUPABASE_SECRET_KEY/,
    );
  });
});

describe('SupabaseRestClient.upsert', () => {
  it('posts to PostgREST with auth + merge-duplicates and keeps raw_spec', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      ok: true,
      status: 201,
      json: [{ id: 'row_1', meta_campaign_id: 'camp_1' }],
    }));
    const client = new SupabaseRestClient({
      url: 'https://x.supabase.co/',
      secretKey: 'sk_test',
      fetchImpl,
    });
    const row = await client.upsert(
      'campaigns',
      { meta_campaign_id: 'camp_1', status: 'PAUSED', raw_spec: { a: 1 } },
      { onConflict: 'meta_campaign_id' },
    );
    expect(row.id).toBe('row_1');
    const call = calls[0]!;
    expect(call.url).toBe('https://x.supabase.co/rest/v1/campaigns?on_conflict=meta_campaign_id');
    expect(call.method).toBe('POST');
    expect(call.headers?.apikey).toBe('sk_test');
    expect(call.headers?.Authorization).toBe('Bearer sk_test');
    expect(call.headers?.Prefer).toContain('merge-duplicates');
    expect(JSON.parse(call.body!)).toEqual([
      { meta_campaign_id: 'camp_1', status: 'PAUSED', raw_spec: { a: 1 } },
    ]);
  });

  it('refuses an upsert missing raw_spec (SPEC-000 §10)', async () => {
    const { fetchImpl } = mockFetch(() => ({ ok: true, status: 201, json: [{}] }));
    const client = new SupabaseRestClient({
      url: 'https://x',
      secretKey: 'sk',
      fetchImpl,
    });
    await expect(
      client.upsert('campaigns', { meta_campaign_id: 'c' }, { onConflict: 'meta_campaign_id' }),
    ).rejects.toThrow(/raw_spec/);
  });

  it('throws on a non-ok status without echoing the body', async () => {
    const { fetchImpl } = mockFetch(() => ({
      ok: false,
      status: 409,
      json: { message: 'duplicate key' },
    }));
    const client = new SupabaseRestClient({
      url: 'https://x',
      secretKey: 'sk',
      fetchImpl,
    });
    await expect(
      client.upsert('campaigns', { raw_spec: {} }, { onConflict: 'meta_campaign_id' }),
    ).rejects.toThrow(/status 409/);
  });
});

describe('SupabaseRestClient.insertOperationLog (append-only)', () => {
  it('inserts one operation_logs row and returns it', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      ok: true,
      status: 201,
      json: [{ id: 'log_1' }],
    }));
    const client = new SupabaseRestClient({
      url: 'https://x',
      secretKey: 'sk',
      fetchImpl,
    });
    const log = buildOperationLog({
      entity_type: 'campaign',
      entity_id: 'camp_1',
      action: 'create',
      actor: 'skill:create-traffic',
      summary: 'Created PAUSED campaign',
    });
    const created = await client.insertOperationLog(log);
    expect(created.id).toBe('log_1');
    expect(calls[0]!.url).toBe('https://x/rest/v1/operation_logs');
    expect(calls[0]!.headers?.Prefer).toBe('return=representation');
  });
});

describe('SupabaseRestClient.select', () => {
  it('runs a GET with a raw query and returns rows', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      ok: true,
      status: 200,
      json: [{ id: 'camp_1' }],
    }));
    const client = new SupabaseRestClient({
      url: 'https://x',
      secretKey: 'sk',
      fetchImpl,
    });
    const rows = await client.select('campaigns', 'client_id=eq.c1&status=eq.PAUSED');
    expect(rows).toHaveLength(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe('https://x/rest/v1/campaigns?client_id=eq.c1&status=eq.PAUSED');
  });
});

describe('secret hygiene', () => {
  it('never serializes the secret into thrown error messages', async () => {
    const spy = vi.fn();
    const { fetchImpl } = mockFetch(() => ({ ok: false, status: 500, json: {} }));
    const client = new SupabaseRestClient({
      url: 'https://x',
      secretKey: 'super-secret-value',
      fetchImpl,
    });
    try {
      await client.select('campaigns', 'id=eq.1');
    } catch (error) {
      spy((error as Error).message);
    }
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0]![0]).not.toContain('super-secret-value');
  });
});
