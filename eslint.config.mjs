// Shared lint rules for every package (CLAUDE.md hard rule 14: neat, consistent, optimised code).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.next-api/**',
      '**/coverage/**',
      '**/drizzle/meta/**',
      'docs/**',
      '**/*.config.{js,mjs,cjs}',
      '**/scripts/*.mjs',
      '**/public/vendor/**',
      // Plain browser scripts served as files (the push worker), not part of any TypeScript project.
      '**/public/*.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      curly: ['error', 'multi-line'],
      'prefer-const': 'error',
      'object-shorthand': 'error',
      // next-intl's navigation pulls its client Link and the ICU formatter into every page that imports it, even
      // from a server module (spec 16 JS budget, 2026-11-03): use `localePath` / `LocalLink` instead.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'next-intl/navigation', message: 'Use localePath() or <LocalLink> (spec 16 JS budget).' },
          ],
        },
      ],
    },
  },
  {
    // Tests may use non-null assertions on fixtures they just created.
    files: ['**/test/**/*.ts', '**/*.test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: [
      '**/src/migrate.ts',
      '**/src/seed.ts',
      '**/src/seed-demo.ts',
      '**/src/seed-pincodes.ts',
      '**/src/grant-role.ts',
      '**/scripts/**',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // Ustaad Network (spec 23 SR-26): member-written text is always rendered as escaped text, never as HTML.
    files: ['apps/web/src/components/ustaad/**/*.tsx', 'apps/web/src/app/\\[locale\\]/ustaad/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'No dangerouslySetInnerHTML in the Ustaad Network (SR-26): render text, never HTML.',
        },
      ],
    },
  },
  prettier,
);
