// Arena web app ESLint flat configuration (Work Order B001).
//
// Extends the house rules (root eslint.config.mjs) for the Next.js App
// Router host and covers .tsx alongside .ts. Deliberately does NOT add
// eslint-config-next (version-conflict risk with the frozen dependency
// policy — the battery runs lint separately from next build, which has
// build-time linting disabled via next.config.ts).
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.next/**',
      'next-env.d.ts',
      '**/*.generated.*',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs', '**/*.cjs', '**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
