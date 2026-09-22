import { required } from './arrays';
import { normalize, tokenize } from './normalize';
import type { Clause } from './types';

/**
 * Deterministic clause matching for the compare feature.
 *
 * The model is never asked "which clause in version B corresponds to clause 9.2 in version A".
 * That question has a right answer computable from the text, and getting it wrong would make
 * every downstream comparison nonsense. Pairing happens here, in code, and the model is only
 * asked the genuinely judgemental part: whether a difference matters to the employee.
 *
 * Matching runs in two passes, strongest signal first:
 * 1. identical clause labels ("9.2" in both versions), however much the text changed
 * 2. token overlap alone, above a threshold
 *
 * Anything left unmatched is an addition or a removal. Each clause is tokenised once, so pairing
 * a long agreement against its revision stays cheap even though every pair is scored.
 */

/** Below this, two clauses are treated as unrelated rather than as a heavy rewrite. */
const SIMILARITY_THRESHOLD = 0.35;

export interface ClausePair {
  pairId: string;
  a: Clause | null;
  b: Clause | null;
  /** Jaccard similarity of the two token sets, or 0 when one side is absent. */
  similarity: number;
  /** True when the two texts are identical once normalised. */
  identical: boolean;
}

/** Words too common in contracts to carry any matching signal. */
const STOP_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'of',
  'to',
  'and',
  'or',
  'in',
  'for',
  'by',
  'with',
  'shall',
  'any',
  'this',
  'that',
  'be',
  'is',
  'as',
  'on',
  'at',
  'from',
  'such',
]);

/** Content words of already-normalised text, for overlap scoring. */
function tokenSet(normalized: string): Set<string> {
  const tokens = tokenize(normalized)
    .map((token) => token.value.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

/** Jaccard similarity: shared words over total distinct words. */
export function similarity(a: string, b: string): number {
  return jaccard(tokenSet(normalize(a)), tokenSet(normalize(b)));
}

function jaccard(setA: ReadonlySet<string>, setB: ReadonlySet<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let shared = 0;
  for (const token of setA) {
    if (setB.has(token)) shared += 1;
  }
  return shared / (setA.size + setB.size - shared);
}

interface Candidate {
  aIndex: number;
  bIndex: number;
  /** Similarity, lifted above every unlabelled candidate when the labels match. */
  score: number;
  similarity: number;
}

/**
 * Pairs clauses between two versions.
 *
 * Greedy rather than optimal: candidate pairs are scored, sorted, and taken best-first, so each
 * clause is used at most once. A full assignment solve would be more precise on a document that
 * reorders heavily, which offer-letter revisions do not.
 */
export function pairClauses(
  clausesA: readonly Clause[],
  clausesB: readonly Clause[],
): ClausePair[] {
  // Normalised and tokenised once per clause: doing it inside the pair loop made a 150-clause
  // comparison take seconds of CPU.
  const normalizedA = clausesA.map((clause) => normalize(clause.text));
  const normalizedB = clausesB.map((clause) => normalize(clause.text));
  const tokensA = normalizedA.map(tokenSet);
  const tokensB = normalizedB.map(tokenSet);
  const candidates: Candidate[] = [];

  clausesA.forEach((a, aIndex) => {
    clausesB.forEach((b, bIndex) => {
      const score = jaccard(required(tokensA, aIndex), required(tokensB, bIndex));
      if (a.label !== null && a.label === b.label) {
        // A shared label is strong evidence even when the text was rewritten wholesale.
        candidates.push({ aIndex, bIndex, score: 1 + score, similarity: score });
        return;
      }
      if (score >= SIMILARITY_THRESHOLD) {
        candidates.push({ aIndex, bIndex, score, similarity: score });
      }
    });
  });

  candidates.sort((first, second) => second.score - first.score);

  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: ClausePair[] = [];

  for (const candidate of candidates) {
    if (usedA.has(candidate.aIndex) || usedB.has(candidate.bIndex)) continue;
    const a = clausesA[candidate.aIndex];
    const b = clausesB[candidate.bIndex];
    if (!a || !b) continue;

    usedA.add(candidate.aIndex);
    usedB.add(candidate.bIndex);
    pairs.push({
      pairId: `${a.id}-${b.id}`,
      a,
      b,
      similarity: candidate.similarity,
      identical:
        required(normalizedA, candidate.aIndex) === required(normalizedB, candidate.bIndex),
    });
  }

  clausesA.forEach((a, index) => {
    if (usedA.has(index)) return;
    pairs.push({
      pairId: `${a.id}-none`,
      a,
      b: null,
      similarity: 0,
      identical: false,
    });
  });

  clausesB.forEach((b, index) => {
    if (usedB.has(index)) return;
    pairs.push({
      pairId: `none-${b.id}`,
      a: null,
      b,
      similarity: 0,
      identical: false,
    });
  });

  // Document order of version A first, then additions, so the table reads top to bottom.
  return pairs.sort((first, second) => {
    const firstOrder = first.a?.order ?? Number.MAX_SAFE_INTEGER;
    const secondOrder = second.a?.order ?? Number.MAX_SAFE_INTEGER;
    if (firstOrder !== secondOrder) return firstOrder - secondOrder;
    return (first.b?.order ?? 0) - (second.b?.order ?? 0);
  });
}

/** Pairs worth sending to the model: identical clauses need no explanation. */
export function changedPairs(pairs: readonly ClausePair[]): ClausePair[] {
  return pairs.filter((pair) => !pair.identical);
}

/** How many clauses came through the revision untouched, for the "nothing else changed" line. */
export function unchangedCount(pairs: readonly ClausePair[]): number {
  return pairs.filter((pair) => pair.identical).length;
}
