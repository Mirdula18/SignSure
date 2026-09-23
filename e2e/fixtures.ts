import { test as base } from '@playwright/test';

/**
 * Test fixtures.
 *
 * The suite is hermetic: nothing it touches leaves the machine. The Gemini proxy runs in mock
 * mode, and a session is issued by our own Function, so the whole session → bearer-token path
 * runs for real without a single third-party call.
 *
 * Rate limiting: every test would otherwise share one client IP and exhaust the eight-per-hour
 * analyse budget partway through the run. Each test gets its own `CF-Connecting-IP`, which is
 * both realistic - every test is a different person - and leaves the limiter fully armed rather
 * than disabled for testing. Cloudflare sets that header itself in production and overwrites
 * anything a client sends, so trusting it here changes nothing about the deployed behaviour.
 */

let nextClient = 0;

/**
 * A client address no other test in the run will use, so rate-limit budgets never overlap.
 *
 * The counter alone is not enough: each Playwright worker is its own process with its own
 * counter, so two workers would both hand out the first address. The worker index goes into the
 * address as well.
 */
export function nextClientIp(): string {
  nextClient += 1;
  const worker = base.info().workerIndex % 250;
  return `10.${String(worker)}.${String(Math.floor(nextClient / 250) % 250)}.${String((nextClient % 250) + 1)}`;
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.setExtraHTTPHeaders({ 'CF-Connecting-IP': nextClientIp() });
    await use(context);
  },
});

export { expect } from '@playwright/test';
