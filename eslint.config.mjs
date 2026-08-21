import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * The reference project (Visual Prompt) shipped without a linter. Motion
 * Inspector has one, because "run lint" is a meaningless quality gate
 * otherwise.
 *
 * The rules that earn their place here are the ones that catch the mistakes
 * this codebase is actually prone to: a stray `any` around untrusted AI output,
 * a floating promise in an event handler, an unused import left behind by a
 * refactor.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'preview/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser, ...globals.worker, chrome: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    // The spread has to come first: `disableTypeChecked` carries its own
    // `languageOptions`, and placing it after ours silently replaced the Node
    // globals with nothing — which reported `console` and `Buffer` as undefined
    // in build scripts whose entire job is to use them.
    files: ['scripts/**/*.mjs', '*.config.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node, sourceType: 'module', ecmaVersion: 2023 },
    rules: { 'no-console': 'off' },
  },
);
