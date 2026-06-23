import 'server-only';

import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

import { getServerEnv } from './env';

/**
 * Upstash-backed rate limiting (SPEC-000 §11, ADR 0006).
 *
 * Serverless functions are stateless with cold starts, so the limiter state must
 * live in an external store (Upstash), not process memory. Used on the login
 * endpoint (per IP) and any future public endpoint.
 */
let cachedRedis: Redis | undefined;

function getRedis(): Redis {
  if (cachedRedis === undefined) {
    const env = getServerEnv();
    cachedRedis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return cachedRedis;
}

let cachedLoginLimiter: Ratelimit | undefined;

/** Login limiter: 5 attempts per minute per IP, sliding window. */
export function getLoginRatelimit(): Ratelimit {
  if (cachedLoginLimiter === undefined) {
    cachedLoginLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      prefix: 'rl:login',
      analytics: false,
    });
  }
  return cachedLoginLimiter;
}

/**
 * Run the login limiter for a client identifier (typically the source IP).
 * Returns whether the request is allowed plus the remaining budget.
 */
export async function checkLoginRatelimit(
  identifier: string,
): Promise<{ success: boolean; remaining: number }> {
  const { success, remaining } = await getLoginRatelimit().limit(identifier);
  return { success, remaining };
}

let cachedNexusLimiter: Ratelimit | undefined;

/**
 * Nexus limiter: external-API endpoints (chat/stt/tts) and enqueue (confirm)
 * cost money / hit the queue, so we cap them per session. 30 requests/minute.
 */
export function getNexusRatelimit(): Ratelimit {
  if (cachedNexusLimiter === undefined) {
    cachedNexusLimiter = new Ratelimit({
      redis: getRedis(),
      limiter: Ratelimit.slidingWindow(30, '60 s'),
      prefix: 'rl:nexus',
      analytics: false,
    });
  }
  return cachedNexusLimiter;
}

/** Run the Nexus limiter for an identifier (typically the session id). */
export async function checkNexusRatelimit(
  identifier: string,
): Promise<{ success: boolean; remaining: number }> {
  const { success, remaining } = await getNexusRatelimit().limit(identifier);
  return { success, remaining };
}
