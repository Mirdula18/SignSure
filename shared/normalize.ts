/**
 * Text normalisation used by quote verification.
 *
 * Why it is this careful: the model copies a quote out of clause text we sent it, but PDF
 * extraction, copy-paste and line wrapping introduce differences that carry no meaning - soft
 * hyphens at line breaks, curly quotes, non-breaking spaces, zero-width joiners inside
 * Devanagari. Normalising those away lets an honest quote verify, while keeping every
 * meaningful character so a *wrong* quote still fails.
 *
 * `normalizeWithMap` additionally records where each normalised character came from, so a match
 * found in normalised space can be highlighted in the untouched original text.
 *
 * Escapes rather than literal characters are used below so the table stays readable in review.
 */

/**
 * Characters that carry no meaning for matching and are dropped entirely.
 *
 * Listed as code points because every one of them is invisible: a literal table here would
 * be impossible to review.
 */
const IGNORABLE: ReadonlySet<string> = new Set(
  [
    0x00ad, // soft hyphen, inserted by PDF renderers at line breaks
    0x200b, // zero-width space
    0x200c, // zero-width non-joiner
    0x200d, // zero-width joiner
    0x200e, // left-to-right mark
    0x200f, // right-to-left mark
    0x2060, // word joiner
    0xfeff, // byte-order mark
  ].map((codePoint) => String.fromCodePoint(codePoint)),
);

/** Typographic variants folded to their ASCII equivalent. */
const PUNCTUATION: ReadonlyMap<string, string> = new Map([
  ['‘', "'"], // left single quotation mark
  ['’', "'"], // right single quotation mark, also used as apostrophe
  ['‚', "'"], // single low-9 quotation mark
  ['‛', "'"], // single high-reversed-9 quotation mark
  ['′', "'"], // prime
  ['´', "'"], // acute accent, often typed as an apostrophe
  ['ʼ', "'"], // modifier letter apostrophe
  ['“', '"'], // left double quotation mark
  ['”', '"'], // right double quotation mark
  ['„', '"'], // double low-9 quotation mark
  ['‟', '"'], // double high-reversed-9 quotation mark
  ['″', '"'], // double prime
  ['«', '"'], // left guillemet
  ['»', '"'], // right guillemet
  ['‐', '-'], // hyphen
  ['‑', '-'], // non-breaking hyphen
  ['‒', '-'], // figure dash
  ['–', '-'], // en dash
  ['—', '-'], // em dash
  ['―', '-'], // horizontal bar
  ['⁃', '-'], // hyphen bullet
  ['−', '-'], // minus sign
  ['…', '...'], // horizontal ellipsis
]);

/**
 * One code point plus any combining marks that follow it. The `u` flag makes `[\s\S]` match a
 * whole code point, so surrogate pairs are never split, and `match.index` stays a UTF-16 offset.
 */
const CLUSTER = /[\s\S]\p{M}*/gu;

const WHITESPACE = /\s/;

export interface NormalizedText {
  /** The normalised string. */
  text: string;
  /** `start[i]` is the index in the original input where `text[i]` came from. */
  start: number[];
  /**
   * `end[i]` is the index just past the source cluster that produced `text[i]`.
   *
   * Kept separately from `start` because a cluster can be several UTF-16 units long: a
   * Devanagari consonant plus its matra normalises to one unit of `text`, and highlighting with
   * `start + 1` would cut the matra off and render the word wrong.
   */
  end: number[];
}

/**
 * Normalises text and records the origin of every character.
 *
 * Processing happens per cluster (a base character plus any combining marks) so that Unicode
 * composition is applied the same way regardless of how the source encoded it - which matters
 * for Devanagari, where a nukta may be precomposed in one copy and decomposed in another.
 */
export function normalizeWithMap(input: string): NormalizedText {
  const out: string[] = [];
  const start: number[] = [];
  const end: number[] = [];

  let pendingSpace: { from: number; to: number } | null = null;

  // One entry per UTF-16 unit, never per code point: normalised offsets come from
  // `String.prototype.indexOf`, so the maps have to stay index-for-index with `text` even when
  // a character outside the basic plane occupies two units.
  const push = (value: string, from: number, to: number): void => {
    for (let i = 0; i < value.length; i += 1) {
      out.push(value.charAt(i));
      start.push(from);
      end.push(to);
    }
  };

  for (const match of input.matchAll(CLUSTER)) {
    const cluster = match[0];
    const from = match.index;
    const to = from + cluster.length;

    if (IGNORABLE.has(cluster)) continue;

    if (WHITESPACE.test(cluster)) {
      // Runs of whitespace collapse to one space, and leading space is dropped entirely.
      if (out.length > 0 && pendingSpace === null) pendingSpace = { from, to };
      continue;
    }

    if (pendingSpace !== null) {
      push(' ', pendingSpace.from, pendingSpace.to);
      pendingSpace = null;
    }

    const mapped = PUNCTUATION.get(cluster);
    if (mapped !== undefined) {
      push(mapped, from, to);
      continue;
    }

    push(cluster.normalize('NFKC').toLowerCase(), from, to);
  }

  // A pending space at the end is trailing whitespace, so it is never emitted.
  return { text: out.join(''), start, end };
}

/** Normalised text without the origin map, for callers that only need to compare. */
export function normalize(input: string): string {
  return normalizeWithMap(input).text;
}

/** A word of normalised text together with its offsets in that normalised string. */
export interface Token {
  value: string;
  start: number;
  end: number;
}

/**
 * Splits normalised text into word tokens.
 *
 * Fuzzy matching compares sequences of tokens rather than characters, so one changed word costs
 * exactly one edit instead of several character edits.
 */
export function tokenize(normalized: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    if (normalized[cursor] === ' ') {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < normalized.length && normalized[cursor] !== ' ') cursor += 1;
    tokens.push({ value: normalized.slice(start, cursor), start, end: cursor });
  }
  return tokens;
}
