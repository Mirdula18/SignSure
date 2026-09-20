import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';

/** Blocks the three APIs that would let untrusted document text execute as code or HTML. */
const noUnsafeDynamicCode = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message:
      'dangerouslySetInnerHTML is banned: document and model text is untrusted. Highlight by splitting strings into React nodes.',
  },
  {
    selector: "CallExpression[callee.name='eval']",
    message: 'eval is banned.',
  },
  {
    selector: "NewExpression[callee.name='Function']",
    message: 'new Function is banned.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.wrangler/**',
      'node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Three projects because the browser, Workers and Node tooling have different globals.
        project: ['./tsconfig.app.json', './tsconfig.functions.json', './tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      'no-restricted-syntax': ['error', ...noUnsafeDynamicCode],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  // Browser code
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.strict.rules,
      'jsx-a11y/no-autofocus': ['error', { ignoreNonDOM: true }],
    },
  },
  // Pure shared logic: must not reach for DOM or Node globals, because it also runs in Workers.
  {
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'shared/ must stay DOM-free; it also runs in Workers.' },
        { name: 'window', message: 'shared/ must stay DOM-free; it also runs in Workers.' },
        { name: 'localStorage', message: 'shared/ must stay DOM-free.' },
        { name: 'process', message: 'shared/ must stay Node-free.' },
      ],
    },
  },
  // Server code must never log request bodies; console is disallowed outright.
  {
    files: ['functions/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Workers read configuration from `env`, not process.env.' },
      ],
    },
  },
  // Node-side tooling
  {
    files: ['tools/**/*.ts', 'scripts/**/*.{ts,mjs}', '*.config.{ts,js,mjs}', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      'no-console': 'off',
    },
  },
  // Tests
  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts', 'e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
  },
);
