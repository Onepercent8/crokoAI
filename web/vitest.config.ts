import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the dashboard package.
 *
 * Pure libs (`lib/auth/*`, `lib/env`, formatting, Zod schemas) are unit-tested
 * here. Integration tests that touch Supabase/Upstash require credentials and
 * are gated behind environment variables (skipped offline).
 */
export default defineConfig({
  resolve: {
    alias: {
      // The `server-only` guard throws when imported outside a server bundle.
      // Under Vitest we stub it so pure libs (crypto/zod helpers) stay testable;
      // the real guard still protects production builds.
      'server-only': new URL('./test/stubs/server-only.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'lib/**/*.test.ts'],
    passWithNoTests: true,
  },
});
