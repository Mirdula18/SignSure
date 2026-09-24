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

/** The most edits a window of `windowSize` words may need and still score 0.9 against the quote. */
function editBudget(windowSize: number, quoteSize: number): number {
  return Math.ceil(Math.max(windowSize, quoteSize) * (1 - FUZZY_THRESHOLD));
}

/**
 * Word-level Levenshtein distance from every prefix of `window` to `quote`, in one table.
 *
 * Row i of the table compares the first i words of the window with the whole quote, so its last
 * cell is the distance for a window of length i: one table answers every window size that starts
 * at the same word, where computing each size separately repeated the shared rows five times.
 * Comparing words rather than characters means a substituted word costs 1, which is what the
 * 0.9 threshold is calibrated against.
 *
 * Distances above `maxDistance` are reported as `maxDistance + 1`: any such window fails anyway.
 */
function prefixDistances(
  window: readonly string[],
  quote: readonly string[],
  maxDistance: number,
): number[] {
  const tooFar = maxDistance + 1;
  const distances = [Math.min(quote.length, tooFar)];
  // Any cell more than `maxDistance` off the diagonal already costs more than the budget, so
  // only a band that wide is computed; everything outside it stays at the "too far" value.
  let previous = Array.from({ length: quote.length + 1 }, (_, index) => Math.min(index, tooFar));
  let current = new Array<number>(quote.length + 1).fill(tooFar);

  for (const [windowIndex, windowToken] of window.entries()) {
    const row = windowIndex + 1;
    const from = Math.max(1, row - maxDistance);
    const to = Math.min(quote.length, row + maxDistance);
    current.fill(tooFar);
    current[0] = Math.min(row, tooFar);
    let rowMin = current[0];
    for (let column = from; column <= to; column += 1) {
      const cost = windowToken === required(quote, column - 1) ? 0 : 1;
      const value = Math.min(
        required(previous, column) + 1,
        required(current, column - 1) + 1,
        required(previous, column - 1) + cost,
        tooFar,
      );
      current[column] = value;
      if (value < rowMin) rowMin = value;
    }
    // No later row can have a smaller cell, so once a whole row is past the budget every longer
    // prefix is too, and the rest of the table need not be computed.
    if (rowMin > maxDistance) {
      while (distances.length <= window.length) distances.push(tooFar);
      return distances;
    }
    distances.push(required(current, quote.length));
    const swap = previous;
    previous = current;
    current = swap;
  }
  return distances;
}

/**
 * A cheap test that a window *might* be similar enough, run before the edit-distance table.
 *
 * Every edit script leaves at most `shared` tokens untouched (the words the two sequences have
 * in common, counted with multiplicity), so the distance is at least `longest - shared`. When
 * that floor is already past the edit budget, the window cannot score 0.9 and the O(n*m) table
 * is skipped. It only ever rules out windows that would fail anyway, so results are identical:
 * on a 4,000-character clause this turns most of the search into a count.
 */
function couldReachThreshold(windowSize: number, quoteSize: number, shared: number): boolean {
  return Math.max(windowSize, quoteSize) - shared <= editBudget(windowSize, quoteSize);
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

  const needleCounts = new Map<string, number>();
  for (const value of needleValues) needleCounts.set(value, (needleCounts.get(value) ?? 0) + 1);
  // One band wide enough for the longest window serves every shorter one as well.
  const tableBudget = editBudget(maxSize, target);

  // No window can share more words with the quote than the whole clause does. When even that is
  // too few, nothing here can score 0.9 - typically a quote the model made up - and one count
  // over the clause settles it instead of a search over every window.
  const clauseLeft = new Map(needleCounts);
  let clauseShared = 0;
  for (const value of haystackValues) {
    const left = clauseLeft.get(value) ?? 0;
    if (left > 0) {
      clauseLeft.set(value, left - 1);
      clauseShared += 1;
    }
  }
  if (target - clauseShared > tableBudget) return null;

  let best: FuzzyWindow | null = null;

  for (const [start, firstToken] of haystackTokens.entries()) {
    // Words this window shares with the quote, counted once each, as the window grows by one
    // token at a time. That count is what lets most windows skip the edit-distance table.
    const unmatched = new Map(needleCounts);
    let shared = 0;
    const take = (value: string) => {
      const left = unmatched.get(value) ?? 0;
      if (left > 0) {
        unmatched.set(value, left - 1);
        shared += 1;
      }
    };
    for (const value of haystackValues.slice(start, start + minSize - 1)) take(value);

    // Iterating candidate *last* tokens keeps every lookup in range by construction, so the
    // inner loop needs no bounds guards.
    const lastCandidates = haystackTokens.slice(start + minSize - 1, start + maxSize);
    const hopeful: { size: number; lastToken: Token }[] = [];
    for (const [offset, lastToken] of lastCandidates.entries()) {
      const size = minSize + offset;
      take(lastToken.value);
      if (couldReachThreshold(size, target, shared)) hopeful.push({ size, lastToken });
    }
    if (hopeful.length === 0) continue;

    const longestWindow = haystackValues.slice(start, start + minSize + lastCandidates.length - 1);
    const distances = prefixDistances(longestWindow, needleValues, tableBudget);
    for (const { size, lastToken } of hopeful) {
      const score = 1 - required(distances, size) / Math.max(size, target);
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
