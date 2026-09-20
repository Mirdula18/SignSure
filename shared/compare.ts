import { normalize, tokenize } from './normalize';
import type { Clause, ClauseCategory } from './types';

/**
 * Deterministic clause matching for the compare feature.
 *
 * The model is never asked "which clause in version B corresponds to clause 9.2 in version A".
 * That question has a right answer computable from the text, and getting it wrong would make
 * every downstream comparison nonsense. Pairing happens here, in code, and the model is only
 * asked the genuinely judgemental part: whether a difference matters to the employee.
 *
 * Matching runs in three passes, strongest signal first:
 * 1. identical clause labels ("9.2" in both versions)
 * 2. same category, best token overlap
 * 3. token overlap alone, above a threshold
 *
 * Anything left unmatched is an addition or a removal.
 */

/** Below this, two clauses are treated as unrelated rather than as a heavy rewrite. */
const SIMILARITY_THRESHOLD = 0.35;

export interface ClausePair {
  pairId: string;
  a: Clause | null;
  b: Clause | null;
  /** Category, when the analysis supplied one for either side. */
  category: ClauseCategory;
  /** Jaccard similarity of the two token sets, or 0 when one side is absent. */
  similarity: number;
  /** True when the two texts are identical once normalised. */
  identical: boolean;
}

export type CategoryLookup = Readonly<Record<string, ClauseCategory | undefined>>;

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

function tokenSet(text: string): Set<string> {
  const tokens = tokenize(normalize(text))
    .map((token) => token.value.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  return new Set(tokens);
}

/** Jaccard similarity: shared words over total distinct words. */
export function similarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
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
  score: number;
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
  categories: CategoryLookup = {},
): ClausePair[] {
  const candidates: Candidate[] = [];

  clausesA.forEach((a, aIndex) => {
    clausesB.forEach((b, bIndex) => {
      const score = similarity(a.text, b.text);
      const sameLabel = a.label !== null && a.label === b.label;
      const sameCategory = categories[a.id] !== undefined && categories[a.id] === categories[b.id];

      if (sameLabel) {
        // A shared label is strong evidence even when the text was rewritten wholesale.
        candidates.push({ aIndex, bIndex, score: 1 + score });
        return;
      }
      if (sameCategory) {
        // Deliberately not conditional on text overlap: a clause rewritten from scratch shares
        // almost no words with the version it replaces, and that total rewrite is exactly the
        // change a reader most needs to see. Where several clauses share a category, the
        // greedy best-first pass below still prefers the textually closest of them.
        candidates.push({ aIndex, bIndex, score: 0.5 + score });
        return;
      }
      if (score >= SIMILARITY_THRESHOLD) candidates.push({ aIndex, bIndex, score });
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
      category: categories[a.id] ?? categories[b.id] ?? 'GENERAL',
      similarity: similarity(a.text, b.text),
      identical: normalize(a.text) === normalize(b.text),
    });
  }

  clausesA.forEach((a, index) => {
    if (usedA.has(index)) return;
    pairs.push({
      pairId: `${a.id}-none`,
      a,
      b: null,
      category: categories[a.id] ?? 'GENERAL',
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
      category: categories[b.id] ?? 'GENERAL',
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
