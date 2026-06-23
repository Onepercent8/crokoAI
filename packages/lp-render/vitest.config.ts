import { defineConfig } from 'vitest/config';

// Package test config (SPEC-000 §11: heavy unit coverage on pure domain).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
  },
});
