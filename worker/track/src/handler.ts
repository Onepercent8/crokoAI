import { trackEventSchema } from './schema.js';
import { corsHeaders, isAllowedOrigin, securityHeaders } from './cors.js';
import { checkRateLimit } from './rate-limit.js';
import { deriveHashedUserData, toLpEventRow } from './derive.js';
import { fanOut } from './destinations.js';
import type { Destination, EdgeStore, Logger, LpEventsSink } from './ports.js';

/**
 * Tracking handler (SPEC-015 §Comportamento). Pure over injected ports so it is
 * unit-testable offline (no Workers runtime, no real network).
 *
 * Mandatory order (.claude/rules/security.md):
 *   origin/CORS -> validation -> rate limit -> dedup -> derive(NO-PII) ->
 *   fan-out -> mirror to lp_events -> respond.
 *
 * The response never echoes the body nor returns PII. Email/phone exist only in
 * memory to be hashed for fan-out and are discarded at the end of the request.
 */

export interface TrackRequest {
  method: string;
  /** Path of the request (e.g. `/e`). */
  path: string;
  origin: string | null;
  /** Client IP (CF-Connecting-IP). Hashed before use; never persisted. */
  ip: string;
  /** Edge geo country (request.cf.country); used instead of any body field. */
  country: string | undefined;
  /** Parsed JSON body (unknown — validated by the schema). */
  body: unknown;
}

export interface TrackResponse {
  status: number;
  headers: Record<string, string>;
  body: { ok: boolean; error?: string; event_id?: string };
}

export interface HandlerConfig {
  allowedOriginSuffix: string;
  rateLimitPerMinute: number;
}

export interface HandlerDeps {
  store: EdgeStore;
  sink: LpEventsSink;
  destinations: readonly Destination[];
  logger: Logger;
  config: HandlerConfig;
  /** Schedules fan-out without blocking the response (ctx.waitUntil in prod). */
  defer: (promise: Promise<unknown>) => void;
}

function json(
  status: number,
  body: TrackResponse['body'],
  extra: Record<string, string> = {},
): TrackResponse {
  return {
    status,
    headers: { 'Content-Type': 'application/json', ...securityHeaders(), ...extra },
    body,
  };
}

export async function handleTrack(req: TrackRequest, deps: HandlerDeps): Promise<TrackResponse> {
  const { config, logger } = deps;

  // 1. Origin / CORS (auth surrogate at the boundary).
  const allowed = isAllowedOrigin(req.origin, config.allowedOriginSuffix);

  // Preflight: answer OPTIONS for an allowed origin; otherwise 403.
  if (req.method === 'OPTIONS') {
    if (!allowed || req.origin === null) {
      return json(403, { ok: false, error: 'origin_not_allowed' });
    }
    return {
      status: 204,
      headers: { ...securityHeaders(), ...corsHeaders(req.origin) },
      body: { ok: true },
    };
  }

  if (req.method !== 'POST') {
    return json(405, { ok: false, error: 'not_found' });
  }
  if (req.path !== '/e') {
    return json(404, { ok: false, error: 'not_found' });
  }
  if (!allowed || req.origin === null) {
    return json(403, { ok: false, error: 'origin_not_allowed' });
  }
  const cors = corsHeaders(req.origin);

  // 2. Validation (input is data, not instruction).
  const parsed = trackEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return json(400, { ok: false, error: 'invalid_payload' }, cors);
  }
  const event = parsed.data;

  // 3. Rate limit by hashed IP.
  const rl = await checkRateLimit(deps.store, req.ip, config.rateLimitPerMinute);
  if (!rl.allowed) {
    return json(
      429,
      { ok: false, error: 'rate_limited' },
      {
        ...cors,
        'Retry-After': String(rl.retryAfter),
      },
    );
  }

  // 4. Dedup (best-effort edge layer).
  if (await deps.store.hasEvent(event.event_id)) {
    return json(202, { ok: true, event_id: event.event_id }, cors);
  }

  // 5. NO-PII derivation + hashing (PII stays in memory only).
  const row = toLpEventRow(event, req.country);
  const hashed = await deriveHashedUserData(event);

  // 6. Fan-out (deferred, best-effort, isolated failures).
  deps.defer(fanOut(deps.destinations, { event, hashed, country: req.country }, logger));

  // 7. Mirror to lp_events (definitive idempotency via unique event_id).
  try {
    await deps.sink.insert(row);
    await deps.store.markEvent(event.event_id);
  } catch (error) {
    logger.error('failed to write lp_events', {
      event_id: event.event_id,
      reason: (error as Error).message,
    });
    return json(500, { ok: false, error: 'internal' }, cors);
  }

  // 8. Respond. PII is discarded as the request ends.
  return json(202, { ok: true, event_id: event.event_id }, cors);
}
