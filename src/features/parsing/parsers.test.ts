import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '@shared/limits';

/**
 * The PDF and DOCX paths, with pdf.js and mammoth replaced.
 *
 * Both libraries are large and need a real worker or a real zip, neither of which belongs in a
 * unit test. What matters here is our code around them: page numbering, the scanned-PDF check,
 * the page cap, releasing the worker, and turning library errors into reasons the UI can explain.
 * The real libraries are exercised end to end in e2e/.
 */

const pdf = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(() => Promise.resolve()),
  cleanup: vi.fn(() => true),
  GlobalWorkerOptions: { workerSrc: '' },
}));

vi.mock('pdfjs-dist', () => ({
  getDocument: pdf.getDocument,
  GlobalWorkerOptions: pdf.GlobalWorkerOptions,
}));

vi.mock('pdfjs-dist/build/pdf.worker.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));

const mammoth = vi.hoisted(() => ({ extractRawText: vi.fn() }));
vi.mock('mammoth', () => ({ default: mammoth, ...mammoth }));

const { parsePdf, PdfParseError } = await import('./pdfParser');
const { parseDocx, DocxParseError } = await import('./docxParser');
const { parseFile } = await import('./parseDocument');

/** A page whose text content is the given lines, one text item each. */
function page(lines: readonly string[]) {
  return {
    getTextContent: () =>
      Promise.resolve({
        items: lines.map((str, index) => ({
          str,
          hasEOL: true,
          transform: [1, 0, 0, 1, 0, 700 - index * 14],
        })),
      }),
    cleanup: pdf.cleanup,
  };
}

/** Makes `getDocument` return a document with the given pages. */
function mockPdf(pages: readonly (readonly string[])[]) {
  pdf.getDocument.mockReturnValue({
    promise: Promise.resolve({
      numPages: pages.length,
      getPage: (n: number) => Promise.resolve(page(pages[n - 1] ?? [])),
    }),
    destroy: pdf.destroy,
  });
}

function mockPdfFailure(name: string) {
  const error = new Error(name);
  error.name = name;
  pdf.getDocument.mockReturnValue({ promise: Promise.reject(error), destroy: pdf.destroy });
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);
const ZIP_BYTES = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);

const LONG_LINE =
  '1. The Employee shall give the Company ninety (90) days written notice of resignation before leaving employment for any reason whatsoever.';

afterEach(() => {
  vi.clearAllMocks();
});

describe('parsePdf', () => {
  it('reads every page and stamps each line with its page number', async () => {
    mockPdf([
      [LONG_LINE],
      [
        '2. A second clause on the second page, long enough to count as real text for the scanned-document check.',
      ],
    ]);
    const result = await parsePdf(new File([PDF_BYTES], 'offer.pdf'));

    expect(result.pageCount).toBe(2);
    expect(result.lines.map((line) => line.page)).toEqual([1, 2]);
    expect(result.isScanned).toBe(false);
    expect(result.truncated).toBe(false);
  });

  it('points pdf.js at a bundled worker rather than a CDN', async () => {
    mockPdf([[LONG_LINE]]);
    await parsePdf(new File([PDF_BYTES], 'offer.pdf'));
    expect(pdf.GlobalWorkerOptions.workerSrc).toBe('/assets/pdf.worker.mjs');
  });

  it('asks pdf.js not to fetch anything, because the file is already in memory', async () => {
    mockPdf([[LONG_LINE]]);
    await parsePdf(new File([PDF_BYTES], 'offer.pdf'));
    expect(pdf.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({ disableAutoFetch: true, disableStream: true }),
    );
  });

  it('recognises a scanned PDF by how little text it yields per page', async () => {
    mockPdf([['Page 1'], [''], ['']]);
    const result = await parsePdf(new File([PDF_BYTES], 'scan.pdf'));
    expect(result.isScanned).toBe(true);
  });

  it('stops at the page cap and says it did', async () => {
    const pages = Array.from({ length: LIMITS.maxPages + 5 }, () => [LONG_LINE]);
    mockPdf(pages);
    const result = await parsePdf(new File([PDF_BYTES], 'huge.pdf'));
    expect(result.truncated).toBe(true);
    expect(result.pageCount).toBe(LIMITS.maxPages + 5);
    expect(new Set(result.lines.map((line) => line.page)).size).toBe(LIMITS.maxPages);
  });

  it('releases each page and the worker when it is done', async () => {
    mockPdf([[LONG_LINE], [LONG_LINE]]);
    await parsePdf(new File([PDF_BYTES], 'offer.pdf'));
    expect(pdf.cleanup).toHaveBeenCalledTimes(2);
    expect(pdf.destroy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['PasswordException', 'ENCRYPTED'],
    ['InvalidPDFException', 'CORRUPT'],
    ['SomethingElse', 'UNKNOWN'],
  ] as const)(
    'turns a %s from pdf.js into %s, and still releases the worker',
    async (name, reason) => {
      mockPdfFailure(name);
      const failure = parsePdf(new File([PDF_BYTES], 'bad.pdf'));
      await expect(failure).rejects.toBeInstanceOf(PdfParseError);
      await expect(failure).rejects.toMatchObject({ reason });
      expect(pdf.destroy).toHaveBeenCalled();
    },
  );

  it('treats a non-Error rejection as unknown', async () => {
    // pdf.js has historically rejected with plain values rather than Errors. A thenable is used
    // because it is the only honest way to produce one: this is behaviour of a dependency, not
    // something our own code should ever do.
    const rejectsWithAString = {
      then(_resolve: unknown, reject: (reason: unknown) => void) {
        reject('weird');
      },
    };
    pdf.getDocument.mockReturnValue({ promise: rejectsWithAString, destroy: pdf.destroy });
    await expect(parsePdf(new File([PDF_BYTES], 'x.pdf'))).rejects.toMatchObject({
      reason: 'UNKNOWN',
    });
  });
});

describe('parseDocx', () => {
  it('splits the extracted text into lines with no page numbers, because DOCX has none', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: 'First line\r\nSecond line', messages: [] });
    const result = await parseDocx(new File([ZIP_BYTES], 'offer.docx'));
    expect(result.lines).toEqual([
      { text: 'First line', page: null },
      { text: 'Second line', page: null },
    ]);
  });

  it('passes mammoth warnings through for display', async () => {
    mammoth.extractRawText.mockResolvedValue({
      value: 'x',
      messages: [{ type: 'warning', message: 'Unrecognised element' }],
    });
    const result = await parseDocx(new File([ZIP_BYTES], 'offer.docx'));
    expect(result.messages).toEqual(['Unrecognised element']);
  });

  it('turns a mammoth failure into a DocxParseError', async () => {
    mammoth.extractRawText.mockRejectedValue(new Error('corrupt zip'));
    await expect(parseDocx(new File([ZIP_BYTES], 'bad.docx'))).rejects.toBeInstanceOf(
      DocxParseError,
    );
  });
});

describe('parseFile with each format', () => {
  it('parses a PDF into clauses with pages', async () => {
    mockPdf([[LONG_LINE]]);
    const result = await parseFile(new File([PDF_BYTES], 'offer.pdf'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.source).toBe('pdf');
    expect(result.document.pageCount).toBe(1);
    expect(result.document.clauses[0]?.page).toBe(1);
  });

  it('reports a scanned PDF with its page count, so the message can be specific', async () => {
    mockPdf([['1'], ['2']]);
    const result = await parseFile(new File([PDF_BYTES], 'scan.pdf'));
    expect(result).toEqual({ ok: false, reason: 'SCANNED_PDF', detail: { pages: 2 } });
  });

  it('passes the truncation flag through', async () => {
    mockPdf(Array.from({ length: LIMITS.maxPages + 1 }, () => [LONG_LINE]));
    const result = await parseFile(new File([PDF_BYTES], 'long.pdf'));
    expect(result.ok && result.truncated).toBe(true);
  });

  it('turns an encrypted PDF into a reason the UI can explain', async () => {
    mockPdfFailure('PasswordException');
    const result = await parseFile(new File([PDF_BYTES], 'locked.pdf'));
    expect(result).toEqual({ ok: false, reason: 'ENCRYPTED' });
  });

  it('turns a corrupt PDF into a reason the UI can explain', async () => {
    mockPdfFailure('InvalidPDFException');
    expect(await parseFile(new File([PDF_BYTES], 'broken.pdf'))).toEqual({
      ok: false,
      reason: 'CORRUPT',
    });
  });

  it('parses a DOCX with no page numbers', async () => {
    mammoth.extractRawText.mockResolvedValue({ value: LONG_LINE, messages: [] });
    const result = await parseFile(new File([ZIP_BYTES], 'offer.docx'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.source).toBe('docx');
    expect(result.document.pageCount).toBeNull();
    expect(result.document.fileName).toBe('offer.docx');
  });

  it('turns a DOCX failure into an unknown error rather than a crash', async () => {
    mammoth.extractRawText.mockRejectedValue(new Error('bad'));
    expect(await parseFile(new File([ZIP_BYTES], 'bad.docx'))).toEqual({
      ok: false,
      reason: 'UNKNOWN',
    });
  });
});
