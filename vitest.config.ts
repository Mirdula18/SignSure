import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const alias = {
  '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
  '@': fileURLToPath(new URL('./src', import.meta.url)),
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    // Two environments: shared/ and functions/ must stay DOM-free, so they run in Node and
    // would fail loudly if they ever reached for `document`.
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'node',
          environment: 'node',
          include: ['shared/**/*.test.ts', 'functions/**/*.test.ts', 'tools/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'browser',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/*.test.{ts,tsx}'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['shared/**/*.ts', 'functions/**/*.ts', 'src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        'src/main.tsx',
        'src/sample/**',
        'functions/lib/mock/**',
        'shared/**/index.ts',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
        'shared/verify.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'shared/normalize.ts': { lines: 100, functions: 100, branches: 100, statements: 100 },
        'shared/rules/**': { lines: 100, functions: 100, branches: 100, statements: 100 },
      },
    },
  },
});
