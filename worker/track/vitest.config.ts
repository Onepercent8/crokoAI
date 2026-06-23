import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the tracking Worker. Tests the pure handler + helpers with
 * injected mocks (no Workers runtime, no real network). e2e against `wrangler
 * dev` is gated on Cloudflare credentials (see README).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
  },
});
