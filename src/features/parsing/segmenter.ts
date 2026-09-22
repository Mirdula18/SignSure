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
  /** Below this, a paragraph that is not a complete sentence is merged into the clause above. */
  minClauseChars?: number;
  /** Above this, a clause is split at a sentence boundary. */
  maxClauseChars?: number;
}

const DEFAULT_MIN_CLAUSE_CHARS = 200;

/**
 * A short paragraph that is at least this long and reads as a finished sentence stands alone.
 *
 * Why: unnumbered offer letters are written as short paragraphs, one term each ("Your CTC will
 * be..."). Merging every paragraph under `minClauseChars` folded a whole letter into one clause,
 * so a citation pointed at the entire letter and the salary term was classified as a greeting.
 */
const MIN_STANDALONE_SENTENCE_CHARS = 60;
const COMPLETE_SENTENCE = /^[\p{Lu}\p{N}"'(].*[.!?।]["')\]]*$/su;

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

/** Words that make a lead-in a sentence rather than a title. */
const SENTENCE_VERB = /\b(shall|will|may|must|is|are|was|were|agrees?|be)\b/i;

/**
 * A short lead-in before the body text ("Non-competition. For a period of...") is a heading.
 *
 * It has to look like a title: five words at most and no verb. Without that, the first sentence
 * of an ordinary clause became its heading, cut at the full stop in "Rs." ("Your annual Cost to
 * Company (CTC) shall be Rs").
 */
function headingFromRest(rest: string): string | null {
  const lead = /^([A-Z][^.]{2,40})\.\s+\S/.exec(rest.trim())?.[1];
  if (lead === undefined) return null;
  if (lead.split(/\s+/).length > 5 || SENTENCE_VERB.test(lead)) return null;
  return lead;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Short joining words stay lower case inside a title: "Probation and Confirmation". */
const MINOR_WORD = /^(a|an|and|as|at|by|for|in|of|on|or|the|to|with)$/;

function titleCase(line: string): string {
  return line
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && MINOR_WORD.test(word)
        ? word
        : word.replace(
            /(^|-)([a-z])/g,
            (_match, joiner: string, character: string) => `${joiner}${character.toUpperCase()}`,
          ),
    )
    .join(' ');
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
 * The title of a numbered section, or null when the block is an ordinary clause.
 *
 * A section title is one short line with no sentence punctuation, immediately followed by its
 * own first sub-clause ("2. PROBATION AND CONFIRMATION" then "2.1 ..."). Requiring the child
 * keeps a short real clause such as "7) Termination." from being swallowed.
 */
function sectionTitle(block: Block, next: Block | undefined): string | null {
  if (block.label === null || next?.label == null) return null;
  if (!next.label.startsWith(`${block.label}.`) || block.lines.length !== 1) return null;

  // The block's text minus its own label, so "2. TITLE" and "Section 4 TITLE" both work.
  const escaped = block.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rest = blockText(block).replace(new RegExp(`^${escaped}[.):]?\\s*`, 'i'), '');
  if (rest.length === 0 || rest.length > 80 || /[.;:!?]$/.test(rest)) return null;
  if (rest.split(/\s+/).length > 8) return null;
  return ALL_CAPS_HEADING.test(rest) ? titleCase(rest) : rest;
}

/**
 * Turns numbered section titles into the heading of the clauses under them.
 *
 * Why: left alone, every section title became a clause with nothing in it to explain or cite -
 * thirteen of the sample letter's thirty-nine clauses were titles.
 */
function foldSectionHeadings(blocks: readonly Block[]): Block[] {
  const folded: Block[] = [];
  let section: { label: string; title: string } | null = null;

  blocks.forEach((block, index) => {
    const title = sectionTitle(block, blocks[index + 1]);
    if (title !== null && block.label !== null) {
      section = { label: block.label, title };
      return;
    }
    if (block.label !== null && !block.label.startsWith(`${section?.label ?? ''}.`)) {
      section = null;
    }
    folded.push(
      section !== null && block.label !== null && block.heading === null
        ? { ...block, heading: section.title }
        : block,
    );
  });
  return folded;
}

/** True for a short block that cannot stand on its own: a sign-off, a salutation, a tail. */
function isFragment(text: string, minChars: number): boolean {
  if (text.length >= minChars) return false;
  return text.length < MIN_STANDALONE_SENTENCE_CHARS || !COMPLETE_SENTENCE.test(text);
}

/**
 * Merges short unlabelled fragments into the clause above them.
 *
 * Why: a stray line like "and any renewal thereof." is not a clause, and leaving it alone would
 * put a citation target in the report that means nothing on its own. Blocks that carry their own
 * number are never merged, because the document itself says they are separate; nor is a short
 * paragraph that is a complete sentence, because in a letter that is how each term is written.
 */
function mergeShortBlocks(blocks: readonly Block[], minChars: number): Block[] {
  const merged: Block[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    const isStandalone = block.label !== null || block.heading !== null;
    if (!isStandalone && previous !== undefined && isFragment(blockText(block), minChars)) {
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

  const blocks = mergeShortBlocks(foldSectionHeadings(toBlocks(lines)), minChars);

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
