import { LIMITS } from '@shared/limits';
import type { ParsedDocument, SourceKind } from '@shared/types';
import { checkFile, type FileRejectionReason } from './fileGuards';
import { linesFromText, segment, totalChars, type SourceLine } from './segmenter';

/**
 * One entry point for every way a document can arrive: a PDF, a Word file, a text file, pasted
 * text, or the built-in sample.
 *
 * Everything here runs in the browser. The raw file is never uploaded; only the segmented
 * clause text is, and only when the user asks for an analysis.
 */

export type ParseFailureReason =
  | FileRejectionReason
  | 'SCANNED_PDF'
  | 'NO_TEXT'
  | 'TOO_MUCH_TEXT'
  | 'ENCRYPTED'
  | 'CORRUPT'
  | 'UNKNOWN';

export interface ParseSuccess {
  ok: true;
  document: ParsedDocument;
  /** Set when the document was longer than the page cap and we read only part of it. */
  truncated: boolean;
}

export interface ParseFailure {
  ok: false;
  reason: ParseFailureReason;
  detail?: Readonly<Record<string, string | number>>;
}

export type ParseResult = ParseSuccess | ParseFailure;

function build(
  lines: readonly SourceLine[],
  source: SourceKind,
  fileName: string | null,
  pageCount: number | null,
  truncated: boolean,
): ParseResult {
  const clauses = segment(lines);
  if (clauses.length === 0) return { ok: false, reason: 'NO_TEXT' };

  const charCount = totalChars(clauses);
  if (charCount > LIMITS.maxTotalChars) {
    return {
      ok: false,
      reason: 'TOO_MUCH_TEXT',
      detail: { chars: charCount, limit: LIMITS.maxTotalChars },
    };
  }

  return {
    ok: true,
    document: { clauses, pageCount, charCount, source, fileName },
    truncated,
  };
}

/** Parses pasted text or the built-in sample. No file, no guards needed. */
export function parseText(text: string, source: 'paste' | 'sample' = 'paste'): ParseResult {
  return build(linesFromText(text), source, null, null, false);
}

/**
 * Parses an uploaded file after checking it.
 *
 * The parser modules are behind dynamic `import()` inside the branches below, so choosing a
 * `.txt` file never downloads pdf.js and choosing a PDF never downloads mammoth.
 */
export async function parseFile(file: File): Promise<ParseResult> {
  const check = await checkFile(file);
  if (!check.ok) {
    return check.detail
      ? { ok: false, reason: check.reason, detail: check.detail }
      : { ok: false, reason: check.reason };
  }

  try {
    if (check.kind === 'pdf') {
      const { parsePdf } = await import('./pdfParser');
      const result = await parsePdf(file);
      if (result.isScanned) {
        return { ok: false, reason: 'SCANNED_PDF', detail: { pages: result.pageCount } };
      }
      return build(result.lines, 'pdf', file.name, result.pageCount, result.truncated);
    }

    if (check.kind === 'docx') {
      const { parseDocx } = await import('./docxParser');
      const result = await parseDocx(file);
      return build(result.lines, 'docx', file.name, null, false);
    }

    const text = await file.text();
    return build(linesFromText(text), 'txt', file.name, null, false);
  } catch (error) {
    return { ok: false, reason: reasonFromError(error) };
  }
}

function reasonFromError(error: unknown): ParseFailureReason {
  if (error instanceof Error && 'reason' in error) {
    const reason = (error as { reason: unknown }).reason;
    if (reason === 'ENCRYPTED' || reason === 'CORRUPT') return reason;
  }
  return 'UNKNOWN';
}
