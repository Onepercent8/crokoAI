import { describe, it, expect } from 'vitest';
import {
  Ga4Destination,
  GoogleAdsDestination,
  MetaCapiDestination,
  fanOut,
  type FetchLike,
} from '../src/destinations.js';
import type { FanoutContext } from '../src/ports.js';
import { CapturingLogger, RecordingDestination } from './mocks.js';

function ctx(eventType = 'purchase'): FanoutContext {
  return {
    event: {
      event_id: '11111111-1111-4111-8111-111111111111',
      event_type: eventType as FanoutContext['event']['event_type'],
      occurred_at: '2026-06-23T12:00:00.000Z',
      landing_page_id: '22222222-2222-4222-8222-222222222222',
      value_cents: 19700,
      currency: 'BRL',
    },
    hashed: { emailSha256: 'a'.repeat(64) },
    country: 'BR',
  };
}

function recordingFetch(status = 200) {
  const calls: Array<{ url: string; body?: string }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, ...(init?.body ? { body: init.body } : {}) });
    return { ok: status < 400, status };
  };
  return { fetchImpl, calls };
}

describe('fanOut isolation', () => {
  it('runs all destinations and isolates a failing one', async () => {
    const ok = new RecordingDestination('ga4');
    const bad = new RecordingDestination('capi', true);
    const logger = new CapturingLogger();
    await fanOut([bad, ok], ctx(), logger);
    expect(ok.calls).toHaveLength(1);
    expect(logger.lines.some((l) => l.level === 'error' && l.message.includes('capi'))).toBe(true);
  });
});

describe('MetaCapiDestination', () => {
  it('sends value in major units and reuses event_id; never sends raw PII', async () => {
    const { fetchImpl, calls } = recordingFetch();
    await new MetaCapiDestination({ pixelId: 'PIX', token: 'tok', fetchImpl }).send(ctx());
    expect(calls[0]?.url).toContain('/PIX/events');
    expect(calls[0]?.body).toContain('"value":197'); // 19700 cents -> 197
    expect(calls[0]?.body).toContain('11111111-1111-4111-8111-111111111111');
    expect(calls[0]?.body).not.toContain('access_token'); // token is in the URL query, not body
  });

  it('throws on a non-ok response (so fan-out can isolate it)', async () => {
    const { fetchImpl } = recordingFetch(500);
    await expect(
      new MetaCapiDestination({ pixelId: 'PIX', token: 'tok', fetchImpl }).send(ctx()),
    ).rejects.toThrow(/CAPI status 500/);
  });
});

describe('Ga4Destination', () => {
  it('posts to the measurement protocol endpoint', async () => {
    const { fetchImpl, calls } = recordingFetch();
    await new Ga4Destination({ measurementId: 'G-1', apiSecret: 'sec', fetchImpl }).send(ctx());
    expect(calls[0]?.url).toContain('google-analytics.com/mp/collect');
  });
});

describe('GoogleAdsDestination', () => {
  it('only forwards purchase events', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const dest = new GoogleAdsDestination({
      conversionId: 'AW-1',
      conversionLabel: 'lbl',
      developerToken: 'dev',
      fetchImpl,
    });
    await dest.send(ctx('page_view'));
    expect(calls).toHaveLength(0);
    await dest.send(ctx('purchase'));
    expect(calls).toHaveLength(1);
  });
});
