import { describe, it, expect } from 'vitest';
import { handleTrack, type HandlerDeps, type TrackRequest } from '../src/handler.js';
import {
  CapturingLogger,
  MemorySink,
  MemoryStore,
  RecordingDestination,
  collectDefer,
  validEvent,
} from './mocks.js';

const ORIGIN = 'https://promo.example.com';

function baseReq(overrides: Partial<TrackRequest> = {}): TrackRequest {
  return {
    method: 'POST',
    path: '/e',
    origin: ORIGIN,
    ip: '203.0.113.7',
    country: 'BR',
    body: validEvent(),
    ...overrides,
  };
}

function makeDeps(
  store = new MemoryStore(),
  sink = new MemorySink(),
  destinations: RecordingDestination[] = [],
  rateLimitPerMinute = 60,
): {
  deps: HandlerDeps;
  store: MemoryStore;
  sink: MemorySink;
  logger: CapturingLogger;
  settle: () => Promise<void>;
} {
  const logger = new CapturingLogger();
  const { defer, settle } = collectDefer();
  return {
    store,
    sink,
    logger,
    settle,
    deps: {
      store,
      sink,
      destinations,
      logger,
      config: { allowedOriginSuffix: '.example.com', rateLimitPerMinute },
      defer,
    },
  };
}

describe('handleTrack — order + gate', () => {
  it('accepts a valid event, writes a NO-PII row, responds 202', async () => {
    const { deps, sink } = makeDeps();
    const res = await handleTrack(baseReq(), deps);
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ok: true, event_id: validEvent().event_id });
    expect(sink.rows).toHaveLength(1);
    // Echoes the validated origin in CORS.
    expect(res.headers['Access-Control-Allow-Origin']).toBe(ORIGIN);
  });

  it('the written row contains no PII', async () => {
    const { deps, sink } = makeDeps();
    await handleTrack(baseReq(), deps);
    const serialized = JSON.stringify(sink.rows[0]);
    expect(serialized).not.toContain('@');
    expect(serialized).not.toContain('99999');
    expect(sink.rows[0]?.has_email).toBe(true);
    expect(sink.rows[0]?.has_phone).toBe(true);
  });

  it('rejects a foreign origin with 403 before validation', async () => {
    const { deps, sink } = makeDeps();
    const res = await handleTrack(baseReq({ origin: 'https://evil.com' }), deps);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('origin_not_allowed');
    expect(sink.rows).toHaveLength(0);
  });

  it('rejects an invalid body with 400', async () => {
    const { deps, sink } = makeDeps();
    const res = await handleTrack(baseReq({ body: { event_type: 'nope' } }), deps);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(sink.rows).toHaveLength(0);
  });

  it('does not echo the received body on a 400', async () => {
    const { deps } = makeDeps();
    const res = await handleTrack(baseReq({ body: { secret: 'leak@example.com' } }), deps);
    expect(JSON.stringify(res.body)).not.toContain('leak@example.com');
  });

  it('rate-limits after the configured threshold (429 + Retry-After)', async () => {
    const { deps } = makeDeps(new MemoryStore(), new MemorySink(), [], 2);
    // 2 allowed, 3rd rejected. Distinct event_ids to bypass dedup.
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111112',
      '11111111-1111-4111-8111-111111111113',
    ];
    const r1 = await handleTrack(baseReq({ body: validEvent({ event_id: ids[0] }) }), deps);
    const r2 = await handleTrack(baseReq({ body: validEvent({ event_id: ids[1] }) }), deps);
    const r3 = await handleTrack(baseReq({ body: validEvent({ event_id: ids[2] }) }), deps);
    expect(r1.status).toBe(202);
    expect(r2.status).toBe(202);
    expect(r3.status).toBe(429);
    expect(r3.body.error).toBe('rate_limited');
    expect(r3.headers['Retry-After']).toBe('60');
  });

  it('is idempotent: a re-delivered event_id is a 202 no-op (one row, no refanout)', async () => {
    const dest = new RecordingDestination('capi');
    const { deps, sink, settle } = makeDeps(new MemoryStore(), new MemorySink(), [dest]);
    const first = await handleTrack(baseReq(), deps);
    await settle();
    const second = await handleTrack(baseReq(), deps);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(sink.rows).toHaveLength(1);
    expect(dest.calls).toHaveLength(1); // fan-out only on the first delivery
  });

  it('returns 405 for non-POST and 404 for unknown path', async () => {
    const { deps } = makeDeps();
    expect((await handleTrack(baseReq({ method: 'GET' }), deps)).status).toBe(405);
    expect((await handleTrack(baseReq({ path: '/other' }), deps)).status).toBe(404);
  });

  it('answers OPTIONS preflight for an allowed origin with CORS headers', async () => {
    const { deps } = makeDeps();
    const res = await handleTrack(baseReq({ method: 'OPTIONS' }), deps);
    expect(res.status).toBe(204);
    expect(res.headers['Access-Control-Allow-Methods']).toContain('POST');
  });

  it('returns 500 when the mirror write fails (event can be retried)', async () => {
    const sink = new MemorySink();
    sink.failNext = true;
    const { deps } = makeDeps(new MemoryStore(), sink);
    const res = await handleTrack(baseReq(), deps);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('internal');
  });
});

describe('handleTrack — fan-out isolation', () => {
  it('a failing destination does not break the mirror nor the response', async () => {
    const ok = new RecordingDestination('ga4');
    const bad = new RecordingDestination('capi', true);
    const { deps, sink, logger, settle } = makeDeps(new MemoryStore(), new MemorySink(), [bad, ok]);
    const res = await handleTrack(baseReq(), deps);
    await settle();
    expect(res.status).toBe(202);
    expect(sink.rows).toHaveLength(1);
    // The healthy destination still received the event.
    expect(ok.calls).toHaveLength(1);
    // The failure was logged without PII.
    const errLine = logger.lines.find((l) => l.level === 'error');
    expect(errLine?.message).toContain('capi');
    expect(JSON.stringify(errLine)).not.toContain('@');
  });

  it('fan-out receives hashed user_data, never raw PII', async () => {
    const dest = new RecordingDestination('capi');
    const { deps, settle } = makeDeps(new MemoryStore(), new MemorySink(), [dest]);
    await handleTrack(baseReq(), deps);
    await settle();
    const ctx = dest.calls[0];
    expect(ctx?.hashed.emailSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
