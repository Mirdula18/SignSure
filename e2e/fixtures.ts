import { test as base, type Page } from '@playwright/test';

/**
 * Test fixtures.
 *
 * Two things make this suite hermetic.
 *
 * Turnstile: the script is intercepted and replaced with a stub that behaves the way the
 * always-passes test key does. The server side short-circuits the documented test secret
 * (`functions/lib/turnstile.ts`), so the whole Turnstile → session → bearer-token path runs for
 * real without a single network call.
 *
 * Rate limiting: every test would otherwise share one client IP and exhaust the eight-per-hour
 * analyse budget partway through the run. Each test gets its own `CF-Connecting-IP`, which is
 * both realistic - every test is a different person - and leaves the limiter fully armed rather
 * than disabled for testing. Cloudflare sets that header itself in production and overwrites
 * anything a client sends, so trusting it here changes nothing about the deployed behaviour.
 */

const TURNSTILE_SCRIPT = /challenges\.cloudflare\.com\/turnstile/;

const STUB = `
  window.turnstile = {
    render(container, options) {
      // Mirrors the real widget: asynchronous, so the app cannot accidentally depend on the
      // token being available during the same tick that render is called.
      setTimeout(() => { options.callback('e2e-turnstile-token'); }, 0);
      return 'e2e-widget';
    },
    remove() {},
  };
`;

export async function stubTurnstile(page: Page): Promise<void> {
  await page.route(TURNSTILE_SCRIPT, (route) =>
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }),
  );
}

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
  page: async ({ page }, use) => {
    await stubTurnstile(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
