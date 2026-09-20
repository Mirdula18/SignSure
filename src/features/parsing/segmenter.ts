import { LIMITS } from '@shared/limits';
import type { Clause } from '@shared/types';

/**
 * Splits a document into clauses with stable ids and page numbers.
 *
 * This is where SignSure's promise that "page numbers come from our data, never the model"
 * is actually kept: the model only ever sees clause ids, and every page shown beside an
 * explanation was recorded here while reading the file.
 *
 * The segmenter is a line-based state machine rather than a regex over the whole text, because
 * page numbers belong to lines: a clause that starts on page 3 and runs onto page 4 has to
 * remember both.
 */

/** One line of extracted text, with the page it was found on. */
export interface SourceLine {
  text: string;
  /** 1-based page, or null for formats without pages (DOCX, pasted text). */
  page: number | null;
}

export interface SegmentOptions {
  /** Below this, a paragraph is merged into the previous clause instead of standing alone. */
  minClauseChars?: number;
  /** Above this, a clause is split at a sentence boundary. */
  maxClauseChars?: number;
}

const DEFAULT_MIN_CLAUSE_CHARS = 200;

/**
 * `1.` `1.1` `2.3.4` `7)` followed by real content.
 *
 * A single-level number must carry a `.` or `)`, otherwise a sentence that merely opens with a
 * figure ("30 days notice is required") would be read as clause 30.
 */
const NUMBERED_HEADING = /^\s*(\d{1,3}(?:\.\d{1,3}){1,3}[.)]?|\d{1,3}[.)])\s+(\S.*)$/;

/** `Clause 5` / `Section 5.1` / `Article IV` / `Annexure A`. */
const NAMED_HEADING =
  /^\s*(clause|section|article|annexure|schedule|appendix)\s+([\dIVXivx.]+)\b[.:)]?\s*(.*)$/i;

/** `(a)` `(i)` `a)` - sub-items, which usually belong to the clause above them. */
const SUB_ITEM = /^\s*\(?([a-z]|[ivx]{1,4})\)\s+(\S.*)$/i;

/** A short all-capitals line, which is how these documents write headings. */
const ALL_CAPS_HEADING = /^[^a-z]*$/;

/** Page furniture that adds nothing and would otherwise become its own clause. */
const NOISE_LINE =
  /^\s*(page\s+\d+(\s*(of|\/)\s*\d+)?|[-–—_*=.\s]{3,}|\d{1,3}|confidential|private\s*&?\s*confidential)\s*$/i;

interface Block {
  lines: SourceLine[];
  label: string | null;
  heading: string | null;
}

function isAllCapsHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (!ALL_CAPS_HEADING.test(trimmed)) return false;
  if (!/[A-Z]/.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 8;
}

/**
 * Whether a line begins a new clause.
 *
 * Sub-items are deliberately *not* boundaries: "(a) ... (b) ..." under clause 7.2 read as one
 * obligation, and splitting them would produce citations too small to verify.
 */
function headingOf(line: string): { label: string | null; heading: string | null } | null {
  const numbered = NUMBERED_HEADING.exec(line);
  if (numbered) {
    const [, label, rest] = numbered;
    return {
      label: label?.replace(/[.)]$/, '') ?? null,
      heading: headingFromRest(rest ?? ''),
    };
  }

  const named = NAMED_HEADING.exec(line);
  if (named) {
    const [, keyword, number, rest] = named;
    return {
      label: `${capitalise(keyword ?? '')} ${number ?? ''}`.trim(),
      heading: headingFromRest(rest ?? ''),
    };
  }

  if (isAllCapsHeading(line)) {
    return { label: null, heading: titleCase(line.trim()) };
  }

  return null;
}

/** A short lead-in before the body text ("Non-competition. For a period of...") is a heading. */
function headingFromRest(rest: string): string | null {
  const match = /^([A-Z][^.]{2,60})\.\s+\S/.exec(rest.trim());
  return match?.[1] ?? null;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function titleCase(line: string): string {
  return line
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase())
    .trim();
}

function blockText(block: Block): string {
  return block.lines
    .map((line) => line.text.trim())
    .filter((text) => text.length > 0)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pagesOf(block: Block): { page: number | null; pageEnd: number | null } {
  const pages = block.lines
    .map((line) => line.page)
    .filter((page): page is number => page !== null);
  if (pages.length === 0) return { page: null, pageEnd: null };
  return { page: Math.min(...pages), pageEnd: Math.max(...pages) };
}

/**
 * Splits text that is too long at the last sentence boundary before the limit.
 *
 * Falling back to a hard cut matters: a clause with no full stops at all still has to be
 * sendable, and an over-long clause would be rejected by `shared/schemas.ts`.
 */
function splitLongText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const lastSentence = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('; '),
      window.lastIndexOf('? '),
    );
    const cut = lastSentence > maxChars * 0.5 ? lastSentence + 1 : maxChars;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}

/** Groups lines into blocks at heading lines and blank-line paragraph breaks. */
function toBlocks(lines: readonly SourceLine[]): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  let sawBlankLine = false;

  const startBlock = (label: string | null, heading: string | null): Block => {
    const block: Block = { lines: [], label, heading };
    blocks.push(block);
    return block;
  };

  for (const line of lines) {
    const trimmed = line.text.trim();

    if (trimmed.length === 0) {
      sawBlankLine = true;
      continue;
    }
    if (NOISE_LINE.test(trimmed)) continue;

    const heading = SUB_ITEM.test(trimmed) ? null : headingOf(trimmed);

    if (heading !== null) {
      current = startBlock(heading.label, heading.heading);
      // An all-capitals heading is a title for what follows, not content of its own.
      if (heading.label === null && heading.heading !== null && isAllCapsHeading(trimmed)) {
        sawBlankLine = false;
        continue;
      }
      current.lines.push(line);
      sawBlankLine = false;
      continue;
    }

    if (current === null || (sawBlankLine && current.lines.length > 0)) {
      current = startBlock(null, null);
    }
    current.lines.push(line);
    sawBlankLine = false;
  }

  return blocks.filter((block) => blockText(block).length > 0);
}

/**
 * Merges short unlabelled blocks into the clause above them.
 *
 * Why: a stray line like "and any renewal thereof." is not a clause, and leaving it alone would
 * put a citation target in the report that means nothing on its own. Blocks that carry their own
 * number are never merged, because the document itself says they are separate.
 */
function mergeShortBlocks(blocks: readonly Block[], minChars: number): Block[] {
  const merged: Block[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    const isStandalone = block.label !== null || block.heading !== null;
    if (!isStandalone && previous !== undefined && blockText(block).length < minChars) {
      previous.lines.push(...block.lines);
      continue;
    }
    merged.push({ ...block, lines: [...block.lines] });
  }
  return merged;
}

/** Zero-padded so ids sort in document order as plain strings. */
function clauseId(index: number): string {
  return `c${String(index + 1).padStart(3, '0')}`;
}

/**
 * Turns extracted lines into clauses.
 *
 * Output is capped at `LIMITS.maxClauses`; a document larger than that is truncated rather than
 * rejected, so the user still gets a report on the part we could read.
 */
export function segment(lines: readonly SourceLine[], options: SegmentOptions = {}): Clause[] {
  const minChars = options.minClauseChars ?? DEFAULT_MIN_CLAUSE_CHARS;
  const maxChars = options.maxClauseChars ?? LIMITS.maxClauseChars;

  const blocks = mergeShortBlocks(toBlocks(lines), minChars);

  const clauses: Clause[] = [];
  for (const block of blocks) {
    const { page, pageEnd } = pagesOf(block);
    for (const text of splitLongText(blockText(block), maxChars)) {
      if (clauses.length >= LIMITS.maxClauses) return clauses;
      const isContinuation = clauses.length > 0 && text !== blockText(block);
      clauses.push({
        id: clauseId(clauses.length),
        label: isContinuation ? null : block.label,
        heading: isContinuation ? null : block.heading,
        text,
        page,
        pageEnd,
        order: clauses.length,
      });
    }
  }
  return clauses;
}

/** Splits a plain string into lines with no page information, for the paste-text path. */
export function linesFromText(text: string): SourceLine[] {
  return text.split(/\r?\n/).map((line) => ({ text: line, page: null }));
}

/** Total characters across clauses, used for the payload limit check. */
export function totalChars(clauses: readonly Clause[]): number {
  return clauses.reduce((sum, clause) => sum + clause.text.length, 0);
}
