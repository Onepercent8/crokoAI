import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the landing template. Tests the build-time content loader
 * (validation of the serialized content-spec) — pure logic, no DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    passWithNoTests: true,
  },
});
