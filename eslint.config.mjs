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
      // Workspaces têm gate próprio (npm run lint --workspaces): web usa `next lint`,
      // os packages rodam typecheck + vitest. O eslint raiz cobre só o nível raiz.
      'web/**',
      'packages/**',
      'landing-pages/**',
      'worker/**',
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
  {
    // Runner-side CommonJS scripts (Playwright/Resend/REST helpers). They run in
    // Node, not in a workspace bundle, so declare CommonJS + Node globals.
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
