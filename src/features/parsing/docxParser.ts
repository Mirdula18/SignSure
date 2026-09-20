import type { SourceLine } from './segmenter';

/**
 * Reads text out of a .docx in the browser.
 *
 * mammoth is imported dynamically for the same reason as pdf.js: most visitors paste text or
 * try the sample, and they should not pay to download a Word parser they never use.
 *
 * DOCX has no page concept - pagination happens at render time in Word - so every line is
 * recorded with `page: null` and the UI shows "Paragraph N" instead of a page number. That is
 * deliberately honest: inventing a page number would break the rule that every citation points
 * at something we actually measured.
 */

export interface DocxParseResult {
  lines: SourceLine[];
  /** Warnings mammoth raised, e.g. unsupported elements. Shown only if nothing was extracted. */
  messages: string[];
}

export class DocxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocxParseError';
  }
}

export async function parseDocx(file: File): Promise<DocxParseResult> {
  const mammoth = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();

  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return {
      lines: result.value.split(/\r?\n/).map((text) => ({ text, page: null })),
      messages: result.messages.map((message) => message.message),
    };
  } catch {
    throw new DocxParseError('The Word file could not be read.');
  }
}
