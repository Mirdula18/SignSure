import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/**
 * The journeys a judge will actually walk, run against the production build with the Pages
 * Functions mounted in-process and MOCK_GEMINI on, so the suite is hermetic and needs no key.
 *
 * These are deliberately end-to-end rather than component tests: the claims SignSure makes -
 * that a quote is checked, that a refusal is honest, that a page number is real - only hold if
 * the whole chain from parser to verifier to UI holds.
 */

/** Gets from the landing page to a finished report using the built-in sample. */
async function openSampleReport(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /try with a sample offer letter/i }).click();

  await expect(
    page.getByRole('heading', { name: /what are you most worried about/i }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: /i might quit early/i }).check();
  await page.getByRole('checkbox', { name: /my next job/i }).check();
  await page.getByRole('button', { name: /analyse my document/i }).click();

  await expect(page.getByRole('tab', { name: /overview/i })).toBeVisible({ timeout: 30_000 });
}

test.describe('the sample journey', () => {
  test('produces a report with a verified high-risk finding and its original text', async ({
    page,
  }) => {
    await openSampleReport(page);

    // At-a-glance summary, with "Not stated" rather than a guess for anything absent.
    await expect(page.getByRole('heading', { name: /at a glance/i })).toBeVisible();

    const redFlags = page.getByRole('heading', { name: /worth a close look/i });
    await expect(redFlags).toBeVisible();

    // At least one HIGH-risk finding, carrying a verified badge.
    const highRisk = page.getByText('High risk').first();
    await expect(highRisk).toBeVisible();
    await expect(page.getByText('Verified quote').first()).toBeVisible();

    // Opening the side-by-side shows the document's own words with the quote marked.
    await page
      .getByRole('button', { name: /view the original text/i })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: /original text/i }).first()).toBeVisible();
    await expect(page.locator('mark').first()).toBeVisible();
  });

  test('shows the India rule cards with their legal basis and review date', async ({ page }) => {
    await openSampleReport(page);

    await expect(page.getByRole('heading', { name: /legal context for india/i })).toBeVisible();
    await expect(page.getByText(/Indian Contract Act, 1872, s\.27/).first()).toBeVisible();
    await expect(page.getByText(/last reviewed/i).first()).toBeVisible();
    await expect(page.getByText(/not advice about your situation/i).first()).toBeVisible();
  });

  test('reports what the document never says', async ({ page }) => {
    await openSampleReport(page);
    await expect(
      page.getByRole('heading', { name: /what this document does not say/i }),
    ).toBeVisible();
    await expect(page.getByText(/leave entitlement/i).first()).toBeVisible();
  });

  test('separates anything it could not verify from the findings it stands behind', async ({
    page,
  }) => {
    await openSampleReport(page);
    await expect(page.getByRole('heading', { name: /we could not check these/i })).toBeVisible();
    await expect(page.getByText('Could not verify').first()).toBeVisible();
  });
});

test.describe('asking questions', () => {
  test('answers from the document and cites a clause you can jump to', async ({ page }) => {
    await openSampleReport(page);
    await page.getByRole('tab', { name: /^ask$/i }).click();

    await page.getByLabel(/your question/i).fill('Can they stop me from joining a competitor?');
    await page.getByRole('button', { name: /^ask$/i }).click();

    await expect(page.getByText(/worth asking a lawyer/i).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: /where this comes from/i })).toBeVisible();

    // Following a citation lands on the clause, in the Clauses tab.
    await page
      .getByRole('button', { name: /go to clause/i })
      .first()
      .click();
    await expect(page.getByRole('tab', { name: /clauses/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('says the document does not cover something rather than guessing', async ({ page }) => {
    await openSampleReport(page);
    await page.getByRole('tab', { name: /^ask$/i }).click();

    await page
      .getByLabel(/your question/i)
      .fill('Will the company pay for my parents health insurance?');
    await page.getByRole('button', { name: /^ask$/i }).click();

    await expect(page.getByText(/your document does not say this/i).first()).toBeVisible({
      timeout: 30_000,
    });
    // A refusal still leaves the reader with something to do next.
    await expect(page.getByRole('heading', { name: /you could ask/i }).first()).toBeVisible();
  });
});

test.describe('preparing for the conversation', () => {
  test('builds a sheet containing the reviewed questions from the rule library', async ({
    page,
  }) => {
    await openSampleReport(page);
    await page.getByRole('tab', { name: /prepare/i }).click();
    await page.getByRole('button', { name: /build my preparation sheet/i }).click();

    await expect(page.getByRole('heading', { name: /questions for a lawyer/i })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/is the amount reduced \(pro-rated\)/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /download as \.md/i })).toBeVisible();
  });
});

test.describe('language and reading level', () => {
  test('switches the whole interface to Hindi', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Language').selectOption('hi');

    await expect(page.getByLabel('भाषा')).toBeVisible();
    await expect(page.getByText(/कानूनी सलाह नहीं है/).first()).toBeVisible();
  });

  test('keeps the reading level choice while moving through the app', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('radio', { name: /simple/i }).check();
    await page.getByRole('button', { name: /try with a sample offer letter/i }).click();
    await expect(page.getByRole('radio', { name: /simple/i })).toBeChecked();
  });
});

/**
 * Builds a one-page, text-layer PDF at run time, so the repository holds no binary fixture.
 * Offsets in the cross-reference table are computed, not hand-counted, so pdf.js reads it
 * without falling back to repair.
 */
function textPdf(lines: readonly string[]): Buffer {
  const escape = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = [
    'BT /F1 11 Tf 14 TL 56 780 Td',
    ...lines.map((line) => `(${escape(line)}) Tj T*`),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${String(Buffer.byteLength(content))} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = Buffer.byteLength(pdf);
    pdf += `${String(index + 1)} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

test.describe('reading a real PDF', () => {
  test('parses a text PDF in the browser with the pdf.js worker and finds its clauses', async ({
    page,
  }) => {
    await page.goto('/');

    await page.setInputFiles('input[type="file"]', {
      name: 'offer-letter.pdf',
      mimeType: 'application/pdf',
      buffer: textPdf([
        '1. Appointment',
        'You are appointed as Software Engineer with effect from the joining date.',
        '2. Notice period',
        'Either party may end this employment by giving ninety days written notice.',
        '3. Probation',
        'You will be on probation for six months from the date of joining.',
      ]),
    });

    await expect(
      page.getByRole('heading', { name: /what are you most worried about/i }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/across 1 pages?\./i)).toBeVisible();
  });
});

test.describe('file guards', () => {
  test('rejects an executable renamed to .pdf on its content, not its name', async ({ page }) => {
    await page.goto('/');

    await page.setInputFiles('input[type="file"]', {
      name: 'malware.pdf',
      mimeType: 'application/pdf',
      // ELF magic bytes: this is not a PDF whatever the filename claims.
      buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]),
    });

    await expect(page.getByRole('alert')).toContainText(/does not look like a pdf/i);
  });

  test('rejects a file type it cannot read, and says which types it can', async ({ page }) => {
    await page.goto('/');

    await page.setInputFiles('input[type="file"]', {
      name: 'photo.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    await expect(page.getByRole('alert')).toContainText(/PDF, Word \(\.docx\) and plain text/i);
  });
});

test.describe('clearing everything', () => {
  test('returns to the start with no trace of the document', async ({ page }) => {
    await openSampleReport(page);
    await page
      .getByRole('button', { name: /clear everything/i })
      .first()
      .click();

    await expect(
      page.getByRole('heading', { name: /understand every clause before you sign/i }),
    ).toBeVisible();
    await expect(page.getByRole('tab', { name: /overview/i })).toBeHidden();
  });
});
