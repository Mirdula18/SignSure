/**
 * The legal terms SignSure explains inline.
 *
 * A first-time employee meets "liquidated damages" and "arbitration" in their offer letter and
 * in our explanations of it. Rather than asking them to leave the page to look a word up, the
 * first mention in each block of text becomes a button that reveals a plain definition.
 *
 * Definitions live in `src/i18n` under `glossary.<id>.definition`, so they are translated and
 * reviewed like every other string. This module only finds where the terms are.
 */

export const GLOSSARY_TERMS = [
  'liquidatedDamages',
  'arbitration',
  'noticePeriod',
  'ctc',
  'indemnity',
  'probation',
  'nonCompete',
  'gratuity',
  'providentFund',
  'jurisdiction',
] as const;

export type GlossaryTermId = (typeof GLOSSARY_TERMS)[number];

/**
 * The surface forms each term appears as. Longer forms are listed first so that, for example,
 * "notice period" wins over a bare "notice" if one were ever added.
 */
const ALIASES: Readonly<Record<GlossaryTermId, readonly string[]>> = {
  liquidatedDamages: ['liquidated damages'],
  arbitration: ['arbitration', 'arbitrator'],
  noticePeriod: ['notice period', 'नोटिस पीरियड'],
  ctc: ['cost to company', 'CTC'],
  indemnity: ['indemnify', 'indemnity'],
  probation: ['probation', 'प्रोबेशन'],
  nonCompete: ['non-compete', 'non compete', 'noncompete'],
  gratuity: ['gratuity', 'ग्रेच्युटी'],
  providentFund: ['provident fund', 'PF'],
  jurisdiction: ['jurisdiction'],
};

export type GlossarySegment = string | { term: GlossaryTermId; text: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word boundaries that work for Devanagari as well as Latin script. `\b` only understands ASCII
 * word characters, so it would never find a boundary around a Hindi word.
 */
const BEFORE = '(?<![\\p{L}\\p{M}\\p{N}])';
const AFTER = '(?![\\p{L}\\p{M}\\p{N}])';

const MATCHERS: readonly { term: GlossaryTermId; pattern: RegExp }[] = GLOSSARY_TERMS.map(
  (term) => ({
    term,
    pattern: new RegExp(
      `${BEFORE}(?:${ALIASES[term].map(escapeRegExp).join('|')})${AFTER}`,
      // "PF" and "CTC" are matched case-sensitively in practice because they only appear in
      // capitals; case-insensitive matching keeps "Arbitration" at the start of a sentence.
      'iu',
    ),
  }),
);

/**
 * Splits text into plain runs and glossary terms.
 *
 * Only the first occurrence of each term is marked: a paragraph with the same button five times
 * is noise, and the reader only needs the definition once. Returning segments instead of markup
 * is what lets the component render them as React nodes, never as HTML.
 */
export function splitOnGlossaryTerms(text: string): GlossarySegment[] {
  const found: { term: GlossaryTermId; start: number; end: number }[] = [];

  for (const { term, pattern } of MATCHERS) {
    const match = pattern.exec(text);
    if (match === null) continue;
    const start = match.index;
    const end = start + match[0].length;
    // Two terms can overlap only if their aliases overlap; the earlier-listed term wins.
    if (found.some((existing) => start < existing.end && end > existing.start)) continue;
    found.push({ term, start, end });
  }

  found.sort((a, b) => a.start - b.start);

  const segments: GlossarySegment[] = [];
  let cursor = 0;
  for (const { term, start, end } of found) {
    if (start > cursor) segments.push(text.slice(cursor, start));
    segments.push({ term, text: text.slice(start, end) });
    cursor = end;
  }
  if (cursor < text.length) segments.push(text.slice(cursor));
  return segments;
}
