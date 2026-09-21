import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against the production build served by `vite preview`, with the Pages Functions
 * mounted in-process (tools/pagesFunctions.ts) and MOCK_GEMINI on, so the suite is hermetic
 * and needs no API key.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 2 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort --host 127.0.0.1',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      MOCK_GEMINI: 'true',
      SESSION_SECRET: 'e2e-session-secret-at-least-32-bytes-long',
      IP_HASH_SALT: 'e2e-ip-hash-salt',
      TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
      ALLOWED_ORIGIN: BASE_URL,
      // Cloudflare's documented always-passes test pair, so the suite exercises the real
      // Turnstile -> session -> bearer-token path rather than skipping past it.
      VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    },
  },
});
