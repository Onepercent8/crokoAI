import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { handle } from 'hono/vercel';
import { z } from 'zod';

import { verifyPassword } from '@/lib/auth/password';
import {
  issueSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifySession,
} from '@/lib/auth/session';
import { isTurnstileEnabled, verifyTurnstile } from '@/lib/auth/turnstile';
import { getServerEnv } from '@/lib/env';
import { checkLoginRatelimit } from '@/lib/ratelimit';
import { listAnalyses } from '@/lib/services/analyses';
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

const loginBodySchema = z.object({
  password: z.string().min(1).max(512),
  turnstileToken: z.string().max(4096).optional(),
});

app.post('/auth/login', async (c) => {
  const env = getServerEnv();

  // rate limit (per IP) — first line against brute force.
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rl = await checkLoginRatelimit(ip);
  if (!rl.success) {
    return c.json({ error: 'too_many_requests' }, 429);
  }

  // validation (Zod) — body is data, not instruction.
  const parsed = loginBodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  // Turnstile (optional) — only enforced when a secret is configured.
  const turnstileSecret = env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (isTurnstileEnabled(turnstileSecret)) {
    const token = parsed.data.turnstileToken;
    const ok = token !== undefined && (await verifyTurnstile(token, turnstileSecret as string, ip));
    if (!ok) {
      return c.json({ error: 'unauthorized' }, 401);
    }
  }

  // logic: constant-time hash comparison.
  const valid = await verifyPassword(parsed.data.password, env.DASHBOARD_PASSWORD);
  if (!valid) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const jwt = await issueSession(env.AUTH_SECRET);
  setCookie(c, SESSION_COOKIE, jwt, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.json({ ok: true });
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

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
