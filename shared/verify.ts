import { required } from './arrays';
import { LIMITS } from './limits';
import {
  normalize,
  normalizeWithMap,
  tokenize,
  type NormalizedText,
  type Token,
} from './normalize';
import type { VerificationStats, VerificationStatus, VerifiedQuote } from './types';

/**
 * Quote verification: the control that turns "the model said so" into "the document says so".
 *
 * Nothing reaches the user as a claim about their contract unless the quote behind it was found
 * in the clause the model attributed it to. A convincing sentence with a quote that is not in
 * the document fails here and is labelled, not shown as fact (docs/AI_PIPELINE.md section 8).
 *
 * Three outcomes:
 * - `verified`  the quote is present after normalisation; offsets point at the original text.
 * - `fuzzy`     a near-identical run of words is present (>= 0.9 token similarity). The model
 *               paraphrased or fixed typography; the user is shown the matched window and a
 *               "close match" badge rather than a clean tick.
 * - `unverified` nothing close enough. The finding is quarantined.
 */

/** Similarity at or above this counts as a fuzzy match. */
const FUZZY_THRESHOLD = 0.9;

/** How many tokens longer or shorter than the quote a candidate window may be. */
const WINDOW_SLACK = 2;

/** Guard so a pathological clause cannot make fuzzy search expensive. */
const MAX_TOKENS_FOR_FUZZY = 2_000;

export interface QuoteMatch {
  status: VerificationStatus;
  /** Offsets into the original clause text. Present for `verified` and `fuzzy`. */
  start?: number;
  end?: number;
  /** 1 for an exact match, otherwise the token similarity of the best window. */
  score: number;
}

/**
 * Levenshtein distance over token sequences, with early exit once the distance cannot beat
 * `maxDistance`. Comparing words rather than characters means a single substituted word costs
 * 1, which is what the 0.9 threshold is calibrated against.
 */
function tokenDistance(a: readonly string[], b: readonly string[], maxDistance: number): number {
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1).fill(0);

  for (const [aIndex, aToken] of a.entries()) {
    current[0] = aIndex + 1;
    let rowMin = aIndex + 1;
    for (const [bIndex, bToken] of b.entries()) {
      const cost = aToken === bToken ? 0 : 1;
      const value = Math.min(
        required(previous, bIndex + 1) + 1,
        required(current, bIndex) + 1,
        required(previous, bIndex) + cost,
      );
      current[bIndex + 1] = value;
      if (value < rowMin) rowMin = value;
    }
    // Every remaining row can only increase the distance, so bail out as soon as the whole row
    // is already worse than the caller's budget.
    if (rowMin > maxDistance) return maxDistance + 1;
    const swap = previous;
    previous = current;
    current = swap;
  }
  return required(previous, b.length);
}

/** Both sequences are non-empty: callers reject empty quotes and use windows of at least one. */
function similarity(a: readonly string[], b: readonly string[]): number {
  const longest = Math.max(a.length, b.length);
  const maxDistance = Math.ceil(longest * (1 - FUZZY_THRESHOLD));
  return 1 - tokenDistance(a, b, maxDistance) / longest;
}

/**
 * Maps a half-open range in normalised space back to a range in the original string.
 *
 * The end comes from the source cluster's own end rather than "start + 1", so a highlight that
 * finishes on a Devanagari consonant keeps its matra.
 */
function toOriginalRange(
  haystack: NormalizedText,
  normalizedStart: number,
  normalizedEnd: number,
): { start: number; end: number } {
  return {
    start: required(haystack.start, normalizedStart),
    end: required(haystack.end, normalizedEnd - 1),
  };
}

interface FuzzyWindow {
  start: number;
  end: number;
  score: number;
  /** How far the window's length is from the quote's, used only to break score ties. */
  lengthGap: number;
}

function bestFuzzyWindow(
  haystackTokens: readonly Token[],
  needleTokens: readonly Token[],
): FuzzyWindow | null {
  const needleValues = needleTokens.map((token) => token.value);
  const haystackValues = haystackTokens.map((token) => token.value);
  const target = needleValues.length;

  const minSize = Math.max(1, target - WINDOW_SLACK);
  const maxSize = target + WINDOW_SLACK;

  let best: FuzzyWindow | null = null;

  for (const [start, firstToken] of haystackTokens.entries()) {
    // Iterating candidate *last* tokens keeps every lookup in range by construction, so the
    // inner loop needs no bounds guards.
    const lastCandidates = haystackTokens.slice(start + minSize - 1, start + maxSize);
    for (const [offset, lastToken] of lastCandidates.entries()) {
      const size = minSize + offset;
      const score = similarity(haystackValues.slice(start, start + size), needleValues);
      if (score < FUZZY_THRESHOLD) continue;

      const lengthGap = Math.abs(size - target);
      // Equal-scoring windows are common: a trailing word can be dropped from the window or
      // counted as a deletion for the same cost. Prefer the window closest in length to the
      // quote, so the highlight covers the whole sentence instead of stopping a word short.
      if (best && (score < best.score || (score === best.score && lengthGap >= best.lengthGap))) {
        continue;
      }
      best = { start: firstToken.start, end: lastToken.end, score, lengthGap };
    }
  }
  return best;
}

/**
 * Checks whether `quote` really appears in `clauseText`.
 *
 * Short quotes are rejected outright: a ten-character fragment like "the company" appears in
 * almost any contract and would prove nothing, so it can never earn a verified badge.
 */
export function verifyQuote(clauseText: string, quote: string): QuoteMatch {
  const trimmedQuote = quote.trim();
  const needle = normalize(trimmedQuote);

  if (needle.length < LIMITS.minQuoteChars) return { status: 'unverified', score: 0 };

  const haystack = normalizeWithMap(clauseText);
  if (haystack.text.length === 0) return { status: 'unverified', score: 0 };

  const exactIndex = haystack.text.indexOf(needle);
  if (exactIndex !== -1) {
    const range = toOriginalRange(haystack, exactIndex, exactIndex + needle.length);
    return { status: 'verified', start: range.start, end: range.end, score: 1 };
  }

  const haystackTokens = tokenize(haystack.text);
  const needleTokens = tokenize(needle);
  if (
    needleTokens.length === 0 ||
    haystackTokens.length === 0 ||
    haystackTokens.length > MAX_TOKENS_FOR_FUZZY
  ) {
    return { status: 'unverified', score: 0 };
  }

  const window = bestFuzzyWindow(haystackTokens, needleTokens);
  if (!window) return { status: 'unverified', score: 0 };

  const range = toOriginalRange(haystack, window.start, window.end);
  return { status: 'fuzzy', start: range.start, end: range.end, score: window.score };
}

/**
 * Builds the `VerifiedQuote` the UI renders, given the clause the model cited.
 *
 * Passing `undefined` for the clause means the model cited an id that is not in the document;
 * that is treated exactly like a failed quote rather than as an error, so one bad citation
 * never takes down a whole response.
 */
export function buildVerifiedQuote(
  clauseId: string,
  quote: string,
  clauseText: string | undefined,
): VerifiedQuote {
  if (clauseText === undefined) {
    return { clauseId, quote: quote.trim(), status: 'unverified' };
  }
  const match = verifyQuote(clauseText, quote);
  if (match.status === 'unverified' || match.start === undefined || match.end === undefined) {
    return { clauseId, quote: quote.trim(), status: 'unverified' };
  }
  return {
    clauseId,
    quote: quote.trim(),
    status: match.status,
    start: match.start,
    end: match.end,
  };
}

/** A quote the UI may present as evidence. Unverified quotes are shown only as a caveat. */
export function isPresentable(quote: VerifiedQuote): boolean {
  return quote.status === 'verified' || quote.status === 'fuzzy';
}

/** Counts of each verification outcome, shown to the user as a trust summary. */
export function summarizeVerification(quotes: readonly VerifiedQuote[]): VerificationStats {
  const stats: VerificationStats = { verified: 0, fuzzy: 0, unverified: 0 };
  for (const quote of quotes) stats[quote.status] += 1;
  return stats;
}
