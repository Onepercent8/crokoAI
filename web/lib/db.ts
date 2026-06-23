import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { getServerEnv } from './env';

/**
 * Server-side Supabase client using the `service_role` secret key (SPEC-000
 * §6/§10, ADR 0002/0005).
 *
 * RLS is deny-by-default and there are no policies for anon/authenticated, so
 * the browser can never read tables. ALL table reads in the dashboard go through
 * `lib/services/*`, which use this client. The `import 'server-only'` guard makes
 * the build fail if this module is ever pulled into a client bundle, keeping the
 * secret key off the browser by construction.
 */
let cachedClient: SupabaseClient | undefined;

export function getDb(): SupabaseClient {
  if (cachedClient === undefined) {
    const env = getServerEnv();
    cachedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: {
        // No user sessions here; the dashboard auth is its own JWT cookie.
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return cachedClient;
}
