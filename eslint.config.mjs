// ESLint flat config — base do monorepo (SPEC-000 §11 Qualidade).
// Regras por pacote podem estender este arquivo conforme as ondas avançam.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'venv/**',
      'dist/**',
      'build/**',
      'out/**',
      '.next/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // TS estrito: proibir `any` injustificado (SPEC-000 §11).
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
