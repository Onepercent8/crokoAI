import { defineConfig } from 'vitest/config';

// Config base de testes (SPEC-000 §11: pirâmide — muito unit, médio integração, pouco e2e).
// `passWithNoTests` mantém o gate verde enquanto ainda não há testes (Onda 0).
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'venv', 'dist', 'build', '.next', 'out'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Cobertura em domain/application (SPEC-000 §11) — alvos por pacote nas ondas seguintes.
      include: ['**/domain/**', '**/application/**'],
    },
  },
});
