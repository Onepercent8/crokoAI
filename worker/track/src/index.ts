import { handleTrack, type HandlerDeps, type TrackRequest } from './handler.js';
import { D1EdgeStore } from './d1-store.js';
import { SupabaseLpEventsSink } from './lp-events-sink.js';
import {
  Ga4Destination,
  GoogleAdsDestination,
  MetaCapiDestination,
  type FetchLike,
} from './destinations.js';
import type { Destination, Logger } from './ports.js';

/**
 * Cloudflare Worker entry (SPEC-015). Wires the real bindings (D1, fetch,
 * secrets) into the pure handler and adapts the Workers Request/Response.
 *
 * Secrets (SUPABASE_SECRET_KEY, META_CAPI_TOKEN, GA4_API_SECRET,
 * GADS_DEVELOPER_TOKEN) are Wrangler secrets — never in code or logs.
 */

export interface Env {
  // vars
  ALLOWED_ORIGIN_SUFFIX?: string;
  RATE_LIMIT_PER_MINUTE?: string;
  SUPABASE_URL: string;
  META_PIXEL_ID?: string;
  GA4_MEASUREMENT_ID?: string;
  GADS_CONVERSION_ID?: string;
  GADS_CONVERSION_LABEL?: string;
  // secrets
  SUPABASE_SECRET_KEY: string;
  META_CAPI_TOKEN?: string;
  GA4_API_SECRET?: string;
  GADS_DEVELOPER_TOKEN?: string;
  // bindings
  TRACK_DB: D1Database;
}

const DEFAULT_ORIGIN_SUFFIX = '.example.com';
const DEFAULT_RATE_LIMIT = 60;

/** NO-PII structured logger to the Workers console. */
const logger: Logger = {
  info: (message, fields) => console.log(JSON.stringify({ level: 'info', message, ...fields })),
  error: (message, fields) => console.error(JSON.stringify({ level: 'error', message, ...fields })),
};

function buildDestinations(env: Env, fetchImpl: FetchLike): Destination[] {
  const destinations: Destination[] = [];
  if (env.META_PIXEL_ID && env.META_CAPI_TOKEN) {
    destinations.push(
      new MetaCapiDestination({
        pixelId: env.META_PIXEL_ID,
        token: env.META_CAPI_TOKEN,
        fetchImpl,
      }),
    );
  }
  if (env.GA4_MEASUREMENT_ID && env.GA4_API_SECRET) {
    destinations.push(
      new Ga4Destination({
        measurementId: env.GA4_MEASUREMENT_ID,
        apiSecret: env.GA4_API_SECRET,
        fetchImpl,
      }),
    );
  }
  if (env.GADS_CONVERSION_ID && env.GADS_CONVERSION_LABEL && env.GADS_DEVELOPER_TOKEN) {
    destinations.push(
      new GoogleAdsDestination({
        conversionId: env.GADS_CONVERSION_ID,
        conversionLabel: env.GADS_CONVERSION_LABEL,
        developerToken: env.GADS_DEVELOPER_TOKEN,
        fetchImpl,
      }),
    );
  }
  return destinations;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const fetchImpl: FetchLike = (input, init) => fetch(input, init);

    const cf = (request as Request & { cf?: { country?: string } }).cf;
    const trackReq: TrackRequest = {
      method: request.method,
      path: url.pathname,
      origin: request.headers.get('Origin'),
      ip: request.headers.get('CF-Connecting-IP') ?? '0.0.0.0',
      country: cf?.country,
      body: request.method === 'POST' ? await readJson(request) : null,
    };

    const deps: HandlerDeps = {
      store: new D1EdgeStore(env.TRACK_DB),
      sink: new SupabaseLpEventsSink({
        url: env.SUPABASE_URL,
        secretKey: env.SUPABASE_SECRET_KEY,
        fetchImpl,
      }),
      destinations: buildDestinations(env, fetchImpl),
      logger,
      config: {
        allowedOriginSuffix: env.ALLOWED_ORIGIN_SUFFIX ?? DEFAULT_ORIGIN_SUFFIX,
        rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? DEFAULT_RATE_LIMIT),
      },
      defer: (promise) => ctx.waitUntil(promise),
    };

    const result = await handleTrack(trackReq, deps);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: result.headers,
    });
  },
};
