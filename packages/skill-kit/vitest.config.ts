import { defineConfig } from 'vitest/config';

// Package-local Vitest config (SPEC-000 §11). Coverage targets domain/application.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist', 'build'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/domain/**', 'src/application/**'],
    },
  },
});
