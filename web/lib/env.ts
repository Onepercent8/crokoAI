/**
 * Environment contract for the dashboard (SPEC-000 §2/§7, Wave 6).
 *
 * Two strictly separated surfaces:
 *  - {@link ServerEnv}: secrets, validated lazily and ONLY readable on the server.
 *  - {@link PublicEnv}: `NEXT_PUBLIC_*` values, safe for the browser (never secrets).
 *
 * Fail-fast: parsing throws if a required variable is missing or malformed, so a
 * misconfigured deploy never boots half-broken. Values come from the Vercel env
 * / `.env.local`; this module NEVER hard-codes any secret.
 */
import { z } from 'zod';

/**
 * Optional env var that is treated as ABSENT when present-but-empty.
 * `.env` templates ship optional keys as `KEY=` (empty string), which `.optional()`
 * alone would reject (it only allows `undefined`). We coerce blank → undefined.
 */
const optionalNonEmpty = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().min(1).optional(),
);

const serverEnvSchema = z.object({
  // Supabase (server-side, service_role — never exposed to the browser).
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  // Auth: signs the session JWT and stores the password as a SHA-256 hex hash.
  AUTH_SECRET: z.string().min(32),
  DASHBOARD_PASSWORD: z
    .string()
    .length(64, 'DASHBOARD_PASSWORD must be a SHA-256 hex digest (64 chars)')
    .regex(/^[0-9a-f]+$/, 'DASHBOARD_PASSWORD must be lowercase hex'),
  // Upstash Redis — rate limiting on login and public endpoints.
  UPSTASH_REDIS_REST_URL: z.string().url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  // Cloudflare Turnstile — optional anti-bot on login.
  CLOUDFLARE_TURNSTILE_SECRET_KEY: optionalNonEmpty,
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY: optionalNonEmpty,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Parse and validate a raw record against the server schema.
 * Exported for unit testing; production code uses {@link getServerEnv}.
 */
export function parseServerEnv(raw: NodeJS.ProcessEnv): ServerEnv {
  const result = serverEnvSchema.safeParse(raw);
  if (!result.success) {
    // Do NOT echo values — only the names of the offending keys.
    const keys = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid server environment: ${keys}`);
  }
  return result.data;
}

/** Parse and validate the browser-safe (`NEXT_PUBLIC_*`) environment. */
export function parsePublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse(raw);
  if (!result.success) {
    const keys = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid public environment: ${keys}`);
  }
  return result.data;
}

let cachedServerEnv: ServerEnv | undefined;

/**
 * Lazily validated, memoized server environment. Throws on first access if the
 * configuration is invalid. Must only be imported from server-side code.
 */
export function getServerEnv(): ServerEnv {
  if (cachedServerEnv === undefined) {
    cachedServerEnv = parseServerEnv(process.env);
  }
  return cachedServerEnv;
}

let cachedPublicEnv: PublicEnv | undefined;

/** Lazily validated, memoized browser-safe environment. */
export function getPublicEnv(): PublicEnv {
  if (cachedPublicEnv === undefined) {
    cachedPublicEnv = parsePublicEnv({
      // Next.js inlines `NEXT_PUBLIC_*` at build time; reference them statically.
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY:
        process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY,
    });
  }
  return cachedPublicEnv;
}
