import type * as PdfJs from 'pdfjs-dist';
import { LIMITS } from '@shared/limits';
import type { SourceLine } from './segmenter';

/**
 * Reads text out of a PDF in the browser.
 *
 * The file never leaves the device: pdf.js runs here, and only the segmented clause text is
 * sent to the API. pdf.js is ~350 kB, so it is imported dynamically the moment a PDF is
 * actually chosen and never lands in the initial bundle.
 */

export interface PdfParseResult {
  lines: SourceLine[];
  pageCount: number;
  /** True when the PDF is page images with no text layer, so there is nothing to read. */
  isScanned: boolean;
  /** True when we stopped early at the page cap. */
  truncated: boolean;
}

export class PdfParseError extends Error {
  constructor(
    message: string,
    readonly reason: 'ENCRYPTED' | 'CORRUPT' | 'UNKNOWN',
  ) {
    super(message);
    this.name = 'PdfParseError';
  }
}

/** Minimal shape of the pdf.js text items we use, so the module needs no ambient types. */
interface TextItemLike {
  str: string;
  hasEOL: boolean;
  transform: number[];
}

function isTextItem(item: unknown): item is TextItemLike {
  if (typeof item !== 'object' || item === null) return false;
  const candidate = item as Record<string, unknown>;
  return typeof candidate.str === 'string' && Array.isArray(candidate.transform);
}

/** Vertical gap, in PDF units, big enough to mean a new line rather than kerning. */
const LINE_BREAK_THRESHOLD = 2;

/**
 * Rebuilds lines from positioned text runs.
 *
 * pdf.js returns text in drawing order with no notion of lines, so a clause arrives as dozens
 * of fragments. Lines are reconstructed from `hasEOL` and, when a generator does not set it,
 * from a change in the baseline y-coordinate. Getting this right is what makes clause
 * boundaries and page numbers trustworthy downstream.
 */
export function linesFromTextItems(items: readonly unknown[], page: number): SourceLine[] {
  const lines: SourceLine[] = [];
  let current = '';
  let currentY: number | null = null;

  const flush = (): void => {
    const text = current.replace(/\s+/g, ' ').trim();
    if (text.length > 0) lines.push({ text, page });
    current = '';
  };

  for (const item of items) {
    if (!isTextItem(item)) continue;

    const y = item.transform[5];
    if (
      typeof y === 'number' &&
      currentY !== null &&
      Math.abs(y - currentY) > LINE_BREAK_THRESHOLD
    ) {
      flush();
    }
    if (typeof y === 'number') currentY = y;

    current += item.str;
    if (item.hasEOL) {
      flush();
      currentY = null;
    }
  }
  flush();
  return lines;
}

/** Loads pdf.js and points it at its worker. Separated so tests can stub the whole module. */
async function loadPdfJs(): Promise<typeof PdfJs> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/**
 * Extracts text from a PDF, one page at a time.
 *
 * `disableAutoFetch` and `disableStream` are on because the file is already in memory: there is
 * nothing to fetch, and the CSP would block it anyway.
 */
export async function parsePdf(file: File): Promise<PdfParseResult> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());

  const loadingTask = pdfjs.getDocument({
    data,
    disableAutoFetch: true,
    disableStream: true,
    useSystemFonts: false,
  });

  let document: Awaited<typeof loadingTask.promise>;
  try {
    document = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    throw toParseError(error);
  }

  try {
    const pageCount = document.numPages;
    const pagesToRead = Math.min(pageCount, LIMITS.maxPages);
    const lines: SourceLine[] = [];
    let characters = 0;

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const pageLines = linesFromTextItems(content.items, pageNumber);
        for (const line of pageLines) characters += line.text.length;
        lines.push(...pageLines);
      } finally {
        page.cleanup();
      }
    }

    return {
      lines,
      pageCount,
      isScanned: characters / pagesToRead < LIMITS.minCharsPerPageForText,
      truncated: pageCount > pagesToRead,
    };
  } finally {
    // Releases the worker; without this a large document holds memory until GC runs.
    await loadingTask.destroy();
  }
}

function toParseError(error: unknown): PdfParseError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') {
    return new PdfParseError('The PDF is password protected.', 'ENCRYPTED');
  }
  if (name === 'InvalidPDFException') {
    return new PdfParseError('The PDF could not be read.', 'CORRUPT');
  }
  return new PdfParseError('The PDF could not be read.', 'UNKNOWN');
}
