import { expect, test } from './fixtures';
import { OFFER_LETTER_PDF_LINES, textPdf } from './pdf';

/**
 * The service worker's job: after one visit, SignSure opens without a network, and everything
 * that runs on the device - reading the sample, choosing concerns - keeps working. Only the
 * model needs the connection, and losing it must end in a message, not a blank page.
 */
test.describe('offline, after one visit', () => {
  test('opens from the cache and says plainly when the analysis needs a connection', async ({
    page,
    context,
  }) => {
    await page.goto('/');
    // Installing the worker is what downloads the app shell into the cache.
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('button', { name: /try with a sample offer letter/i }).click();
    await expect(
      page.getByRole('heading', { name: /what are you most worried about/i }),
    ).toBeVisible();

    await page.getByRole('button', { name: /analyse my document/i }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
  });

  test('keeps the PDF reader after its first use, and only then', async ({ page }) => {
    await page.goto('/');
    // On a first install the worker takes over the open page, without a reload.
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

    const parserCache = () =>
      page.evaluate(async () => {
        const cache = await caches.open('signsure-parsers');
        return (await cache.keys()).map((request) => new URL(request.url).pathname);
      });
    expect(await parserCache()).toEqual([]);

    await page.setInputFiles('input[type="file"]', {
      name: 'offer-letter.pdf',
      mimeType: 'application/pdf',
      buffer: textPdf(OFFER_LETTER_PDF_LINES),
    });
    await expect(
      page.getByRole('heading', { name: /what are you most worried about/i }),
    ).toBeVisible({ timeout: 20_000 });

    await expect
      .poll(parserCache)
      .toEqual(
        expect.arrayContaining([
          expect.stringMatching(/\/assets\/pdfjs-/),
          expect.stringMatching(/\/assets\/pdf\.worker\.min-.*\.mjs$/),
        ]),
      );
  });

  test('never answers an API request from the cache', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await page.reload();

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
      }
      return urls;
    });

    expect(cached).toContain('/index.html');
    expect(cached.filter((path) => path.startsWith('/api/'))).toEqual([]);
    expect(cached.filter((path) => /pdfjs-|mammoth-|pdf\.worker/.test(path))).toEqual([]);
  });
});
