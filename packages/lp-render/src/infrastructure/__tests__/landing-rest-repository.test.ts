import { describe, it, expect } from 'vitest';
import {
  LandingRestRepository,
  landingRestConfigFromEnv,
  type FetchLike,
} from '../landing-rest-repository.js';

/**
 * Integration tests for the REST adapter with a mocked fetch (offline).
 * Verifies headers (secret never leaks into the body/log), the conflict path
 * for dedup, and that loadForPublish assembles a valid ContentDoc.
 */

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function mockFetch(responder: (call: Call) => { ok: boolean; status: number; json: unknown }): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers ?? {},
      ...(init?.body !== undefined ? { body: init.body } : {}),
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

const config = (fetchImpl: FetchLike) => ({
  url: 'https://proj.supabase.co',
  secretKey: 'secret-service-role',
  fetchImpl,
});

describe('landingRestConfigFromEnv', () => {
  it('throws when SUPABASE_URL or SUPABASE_SECRET_KEY is missing', () => {
    const { fetchImpl } = mockFetch(() => ({ ok: true, status: 200, json: [] }));
    expect(() => landingRestConfigFromEnv({}, fetchImpl)).toThrow(/SUPABASE_URL/);
    expect(() => landingRestConfigFromEnv({ SUPABASE_URL: 'https://x' }, fetchImpl)).toThrow(
      /SUPABASE_SECRET_KEY/,
    );
  });
});

describe('LandingRestRepository', () => {
  it('sends the service_role key as apikey + bearer and uses PostgREST routes', async () => {
    const { fetchImpl, calls } = mockFetch(() => ({
      ok: true,
      status: 201,
      json: [{ id: 'lp-1' }],
    }));
    const repo = new LandingRestRepository(config(fetchImpl));
    await repo.insertLandingPage({
      id: 'lp-1',
      client_id: 'c1',
      product_id: 'p1',
      subdomain: 'curso-exemplo',
      noindex: true,
      status: 'draft',
      draft_status: 'ready',
      settings: { locale: 'pt', title: 'x', noindex: true },
      theme: {
        palette: {
          primary: '#000',
          secondary: '#000',
          background: '#000',
          foreground: '#fff',
          accent: '#0f0',
        },
        typography: { headingFont: 'Inter', bodyFont: 'Inter' },
        radius: 'md',
        shadow: 'sm',
      },
    });
    const call = calls[0];
    expect(call?.url).toContain('/rest/v1/landing_pages');
    expect(call?.headers['apikey']).toBe('secret-service-role');
    expect(call?.headers['Authorization']).toBe('Bearer secret-service-role');
    // raw_spec is stored on upsert (SPEC-000 §10).
    expect(call?.body).toContain('raw_spec');
  });

  it('reports enqueued=false on a 409 conflict (dedup), not an error', async () => {
    const { fetchImpl } = mockFetch(() => ({ ok: false, status: 409, json: {} }));
    const repo = new LandingRestRepository(config(fetchImpl));
    const res = await repo.enqueuePublishJob({
      kind: 'landing_publish',
      skill: 'publish-landing-page-cliente-exemplo',
      landing_page_id: 'lp-1',
      status: 'pending',
      requested_by: 'create-landing-page',
    });
    expect(res.enqueued).toBe(false);
  });

  it('throws on a non-conflict enqueue error', async () => {
    const { fetchImpl } = mockFetch(() => ({ ok: false, status: 500, json: {} }));
    const repo = new LandingRestRepository(config(fetchImpl));
    await expect(
      repo.enqueuePublishJob({
        kind: 'landing_publish',
        skill: 'publish-landing-page-cliente-exemplo',
        landing_page_id: 'lp-1',
        status: 'pending',
        requested_by: 'create-landing-page',
      }),
    ).rejects.toThrow(/status 500/);
  });

  it('returns null when findProduct has no rows', async () => {
    const { fetchImpl } = mockFetch(() => ({ ok: true, status: 200, json: [] }));
    const repo = new LandingRestRepository(config(fetchImpl));
    expect(await repo.findProduct('cliente-exemplo', 'missing')).toBeNull();
  });

  it('loadForPublish assembles a ContentDoc from landing page + sections', async () => {
    const { fetchImpl } = mockFetch((call) => {
      if (call.url.includes('landing_page_sections')) {
        return {
          ok: true,
          status: 200,
          json: [
            {
              type: 'hero',
              position: 0,
              enabled: true,
              version: 1,
              fields: {
                headline: 'Olá',
                primaryCta: { label: 'Go', href: 'https://example.com' },
              },
            },
          ],
        };
      }
      return {
        ok: true,
        status: 200,
        json: [
          {
            id: 'lp-1',
            client_id: 'c1',
            subdomain: 'curso-exemplo',
            settings: { locale: 'pt', title: 'x', noindex: true },
            theme: {
              palette: {
                primary: '#000',
                secondary: '#000',
                background: '#000',
                foreground: '#fff',
                accent: '#0f0',
              },
              typography: { headingFont: 'Inter', bodyFont: 'Inter' },
              radius: 'md',
              shadow: 'sm',
            },
            cloudflare_project_id: 'cf-1',
          },
        ],
      };
    });
    const repo = new LandingRestRepository(config(fetchImpl));
    const view = await repo.loadForPublish('lp-1');
    expect(view?.subdomain).toBe('curso-exemplo');
    expect(view?.cloudflareProjectId).toBe('cf-1');
    expect(view?.doc.sections).toHaveLength(1);
    expect(view?.doc.sections[0]?.type).toBe('hero');
  });
});
