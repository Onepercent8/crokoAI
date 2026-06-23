import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { handle } from 'hono/vercel';
import { z } from 'zod';

import { parseLoginBody, responseModeFor } from '@/lib/auth/login-request';
import { verifyPassword } from '@/lib/auth/password';
import {
  issueSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifySession,
} from '@/lib/auth/session';
import { isTurnstileEnabled, verifyTurnstile } from '@/lib/auth/turnstile';
import { getServerEnv } from '@/lib/env';
import {
  CaptureRequest,
  ChatRequest,
  ConfirmRequest,
  NarrationsQuery,
  TtsRequest,
} from '@/lib/nexus/schemas';
import {
  getSttClient,
  getTtsClient,
  getTtsVoiceId,
  nexusCapture,
  nexusChatTurn,
  nexusConfirm,
  nexusReadCapture,
} from '@/lib/nexus/runtime';
import { checkLoginRatelimit, checkNexusRatelimit } from '@/lib/ratelimit';
import { listAnalyses } from '@/lib/services/analyses';
import { listNarrations } from '@/lib/services/narrations';
import { listCampaigns } from '@/lib/services/campaigns';
import { getClientBySlug, listClients } from '@/lib/services/clients';
import { listFunnelEvents } from '@/lib/services/funnel';
import { listAgentEvents, listOperationLogs } from '@/lib/services/logs';

export const runtime = 'nodejs';

/**
 * Catch-all HTTP surface for the dashboard (SPEC-000 §11, ADR 0005/0006).
 *
 * A single Hono app under `/api`. Mandatory chain on every protected route:
 *   auth (valid session) -> authz (operator) -> validation (Zod) -> logic (service).
 *
 * The session-gate (`auth`/`authz`) is enforced by the `/api/*` middleware below
 * (and also in `middleware.ts` as defense in depth). Reads return pure JSON from
 * `lib/services/*` with no mutation. Login is public + rate limited; errors are
 * generic (no leaking whether the password exists).
 */
const app = new Hono().basePath('/api');

// --- Auth (public, rate limited) -------------------------------------------

app.post('/auth/login', async (c) => {
  const env = getServerEnv();

  // The form degrades to a native POST when JS has not hydrated (NOTES §7): we
  // accept both `application/json` (fetch) and `application/x-www-form-urlencoded`
  // (no-JS form) so the password is NEVER placed in the URL. The response mode
  // mirrors the client: JSON for fetch, an HTTP redirect for a navigating form.
  const contentType = c.req.header('content-type');
  const mode = responseModeFor(contentType);

  const fail = (status: 400 | 401 | 429, error: string): Response => {
    if (mode === 'redirect') {
      // Bounce back to the login page (no password in the query) so the no-JS
      // user sees the page again instead of raw JSON.
      return c.redirect('/login?error=1', 303);
    }
    return c.json({ error }, status);
  };

  // rate limit (per IP) — first line against brute force.
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await checkLoginRatelimit(ip);
  if (!rl.success) {
    return fail(429, 'too_many_requests');
  }

  // validation (Zod) — body is data, not instruction. Read the raw text for the
  // form path; the JSON path parses an object.
  const raw =
    mode === 'json' ? await c.req.json().catch(() => null) : await c.req.text().catch(() => '');
  const body = parseLoginBody(contentType, raw);
  if (body === null) {
    return fail(400, 'invalid_request');
  }

  // Turnstile (optional) — only enforced when a secret is configured.
  const turnstileSecret = env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (isTurnstileEnabled(turnstileSecret)) {
    const token = body.turnstileToken;
    const ok = token !== undefined && (await verifyTurnstile(token, turnstileSecret as string, ip));
    if (!ok) {
      return fail(401, 'unauthorized');
    }
  }

  // logic: constant-time hash comparison.
  const valid = await verifyPassword(body.password, env.DASHBOARD_PASSWORD);
  if (!valid) {
    return fail(401, 'unauthorized');
  }

  const jwt = await issueSession(env.AUTH_SECRET);
  setCookie(c, SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return mode === 'redirect' ? c.redirect('/', 303) : c.json({ ok: true });
});

app.post('/auth/logout', (c) => {
  setCookie(c, SESSION_COOKIE, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 0,
  });
  return c.json({ ok: true });
});

// --- Auth/authz gate for every protected route -----------------------------

app.use('/clients', operatorGuard);
app.use('/clients/*', operatorGuard);
app.use('/campaigns', operatorGuard);
app.use('/analyses', operatorGuard);
app.use('/funnel', operatorGuard);
app.use('/logs/*', operatorGuard);
// Every Nexus route requires a valid operator session (no anonymous access).
app.use('/nexus/*', operatorGuard);

/** Hono middleware enforcing a valid operator session (auth + authz). */
async function operatorGuard(
  c: Parameters<Parameters<typeof app.use>[1]>[0],
  next: () => Promise<void>,
): Promise<Response | void> {
  const env = getServerEnv();
  const token = getCookie(c, SESSION_COOKIE);
  const session = await verifySession(token, env.AUTH_SECRET);
  // authz: the single operator subject has full access in this phase.
  if (session === null) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
}

// --- Protected reads --------------------------------------------------------

const uuidQuerySchema = z.object({ clientId: z.string().uuid() });
const analysisQuerySchema = z.object({ analysisId: z.string().uuid() });
const slugParamSchema = z.object({ slug: z.string().min(1).max(128) });
const agentEventsQuerySchema = z.object({
  runId: z.string().min(1).max(128).optional(),
});

app.get('/clients', async (c) => c.json({ clients: await listClients() }));

app.get('/clients/:slug', async (c) => {
  const parsed = slugParamSchema.safeParse({ slug: c.req.param('slug') });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const client = await getClientBySlug(parsed.data.slug);
  if (client === null) {
    return c.json({ error: 'not_found' }, 404);
  }
  return c.json({ client });
});

app.get('/campaigns', async (c) => {
  const parsed = uuidQuerySchema.safeParse({ clientId: c.req.query('clientId') });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  return c.json({ campaigns: await listCampaigns(parsed.data.clientId) });
});

app.get('/analyses', async (c) => {
  const parsed = uuidQuerySchema.safeParse({ clientId: c.req.query('clientId') });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  return c.json({ analyses: await listAnalyses(parsed.data.clientId) });
});

app.get('/funnel', async (c) => {
  const parsed = analysisQuerySchema.safeParse({
    analysisId: c.req.query('analysisId'),
  });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  return c.json({ events: await listFunnelEvents(parsed.data.analysisId) });
});

app.get('/logs/operations', async (c) => {
  const parsed = uuidQuerySchema.safeParse({ clientId: c.req.query('clientId') });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  return c.json({ logs: await listOperationLogs(parsed.data.clientId) });
});

app.get('/logs/events', async (c) => {
  const parsed = agentEventsQuerySchema.safeParse({
    runId: c.req.query('runId') ?? undefined,
  });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  return c.json({ events: await listAgentEvents(parsed.data.runId) });
});

// --- Nexus assistant (Wave 7, SPEC-016) -------------------------------------
//
// Order on every handler: auth (operatorGuard, above) -> rate limit -> Zod
// validation -> logic. Reads execute directly; writes only propose a draft that
// is enqueued on a SEPARATE /nexus/confirm call (two-turn confirmation). The
// skill name is resolved by a server-side slug allowlist; voice/screen content
// is treated as untrusted DATA.

/** Rate-limit a Nexus request by session id; returns a 429 Response or null. */
async function nexusRateGate(sessionId: string): Promise<Response | null> {
  const rl = await checkNexusRatelimit(sessionId);
  return rl.success
    ? null
    : new Response(JSON.stringify({ error: 'too_many_requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      });
}

app.post('/nexus/chat', async (c) => {
  const parsed = ChatRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const limited = await nexusRateGate(parsed.data.session_id);
  if (limited) {
    return limited;
  }

  // Resolve any referenced screen context (ephemeral, untrusted data).
  let screenContext: string | undefined;
  if (parsed.data.screen_context_id !== undefined) {
    screenContext =
      (await nexusReadCapture(parsed.data.session_id, parsed.data.screen_context_id)) ?? undefined;
  }

  const result = await nexusChatTurn({
    sessionId: parsed.data.session_id,
    message: parsed.data.message,
    ...(screenContext !== undefined ? { screenContext } : {}),
  });
  return c.json({
    session_id: parsed.data.session_id,
    reply: result.reply,
    pending_action: result.pendingAction,
    tool_reads: result.toolReads,
  });
});

app.post('/nexus/confirm', async (c) => {
  const parsed = ConfirmRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const limited = await nexusRateGate(parsed.data.session_id);
  if (limited) {
    return limited;
  }
  const result = await nexusConfirm(parsed.data.session_id, parsed.data.action_id);
  return c.json(result);
});

app.post('/nexus/stt', async (c) => {
  const sessionId = c.req.header('x-nexus-session') ?? '';
  if (sessionId.length === 0) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const limited = await nexusRateGate(sessionId);
  if (limited) {
    return limited;
  }
  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  const audio = await c.req.arrayBuffer();
  if (audio.byteLength === 0) {
    return c.json({ error: 'empty_audio' }, 422);
  }
  try {
    const result = await getSttClient().transcribe(audio, contentType);
    return c.json({ text: result.text, duration_ms: result.durationMs });
  } catch {
    return c.json({ error: 'stt_failed' }, 422);
  }
});

app.post('/nexus/tts', async (c) => {
  const parsed = TtsRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const sessionId = c.req.header('x-nexus-session') ?? 'tts';
  const limited = await nexusRateGate(sessionId);
  if (limited) {
    return limited;
  }
  try {
    const voiceId = parsed.data.voice_id ?? getTtsVoiceId();
    const result = await getTtsClient().synthesize(parsed.data.text, voiceId);
    return new Response(result.audio, {
      status: 200,
      headers: { 'content-type': result.contentType },
    });
  } catch {
    // Degrade gracefully: the client falls back to the text reply.
    return c.json({ error: 'tts_unavailable' }, 503);
  }
});

app.post('/nexus/capture', async (c) => {
  const parsed = CaptureRequest.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const limited = await nexusRateGate(parsed.data.session_id);
  if (limited) {
    return limited;
  }
  // The frame is untrusted data; we store only a labelled reference to it.
  const screenContextId = await nexusCapture(
    parsed.data.session_id,
    `[screen capture received at ${new Date().toISOString()}]`,
  );
  return c.json({ screen_context_id: screenContextId });
});

app.get('/nexus/narrations', async (c) => {
  const parsed = NarrationsQuery.safeParse({ session_id: c.req.query('session_id') });
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }
  return c.json({ items: await listNarrations(parsed.data.session_id) });
});

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
