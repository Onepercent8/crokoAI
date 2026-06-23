import { describe, it, expect } from 'vitest';
import { SupabaseLpEventsSink } from '../src/lp-events-sink.js';
import type { FetchLike } from '../src/destinations.js';
import type { LpEventRow } from '../src/derive.js';

const row: LpEventRow = {
  event_id: '11111111-1111-4111-8111-111111111111',
  landing_page_id: '22222222-2222-4222-8222-222222222222',
  event_type: 'purchase',
  value_cents: 19700,
  currency: 'BRL',
  has_email: true,
  has_phone: false,
};

function sink(status: number) {
  const calls: Array<{ url: string; headers: Record<string, string>; body?: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {}, ...(init?.body ? { body: init.body } : {}) });
    return { ok: status < 400, status };
  };
  return {
    sink: new SupabaseLpEventsSink({
      url: 'https://proj.supabase.co/',
      secretKey: 'service-role-secret',
      fetchImpl,
    }),
    calls,
  };
}

describe('SupabaseLpEventsSink', () => {
  it('POSTs to /rest/v1/lp_events with the service_role key and ignore-duplicates', async () => {
    const { sink: s, calls } = sink(201);
    const res = await s.insert(row);
    expect(res.inserted).toBe(true);
    expect(calls[0]?.url).toBe('https://proj.supabase.co/rest/v1/lp_events');
    expect(calls[0]?.headers['apikey']).toBe('service-role-secret');
    expect(calls[0]?.headers['Prefer']).toContain('ignore-duplicates');
  });

  it('treats a 200 (ignored duplicate) as not inserted, no error', async () => {
    const { sink: s } = sink(200);
    expect((await s.insert(row)).inserted).toBe(false);
  });

  it('treats a 409 conflict as not inserted', async () => {
    const { sink: s } = sink(409);
    expect((await s.insert(row)).inserted).toBe(false);
  });

  it('throws on a server error', async () => {
    const { sink: s } = sink(500);
    await expect(s.insert(row)).rejects.toThrow(/status 500/);
  });

  it('never includes PII in the request body (row is NO-PII by construction)', async () => {
    const { sink: s, calls } = sink(201);
    await s.insert(row);
    expect(calls[0]?.body).not.toContain('@');
    expect(calls[0]?.body).toContain('has_email');
  });
});
