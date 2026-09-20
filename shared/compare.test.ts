import { describe, expect, it } from 'vitest';
import { changedPairs, pairClauses, similarity, unchangedCount } from './compare';
import type { Clause, ClauseCategory } from './types';

let nextOrder = 0;

function clause(text: string, label: string | null = null, id?: string): Clause {
  const order = nextOrder++;
  return {
    id: id ?? `c${String(order + 1).padStart(3, '0')}`,
    label,
    heading: null,
    text,
    page: null,
    pageEnd: null,
    order,
  };
}

function reset(): void {
  nextOrder = 0;
}

const NOTICE_V1 =
  'The Employee shall give the Company ninety (90) days written notice of resignation.';
const NOTICE_V2 =
  'The Employee shall give the Company sixty (60) days written notice of resignation.';
const BOND =
  'The Employee shall serve a minimum period of twenty-four months, failing which liquidated damages of Rs. 2,00,000 apply.';
const LEAVE = 'The Employee is entitled to eighteen days of paid leave in each calendar year.';

describe('similarity', () => {
  it('is 1 for identical text', () => {
    expect(similarity(NOTICE_V1, NOTICE_V1)).toBe(1);
  });

  it('is high for text differing only in a number', () => {
    expect(similarity(NOTICE_V1, NOTICE_V2)).toBeGreaterThan(0.6);
  });

  it('is low for clauses about different things', () => {
    expect(similarity(NOTICE_V1, LEAVE)).toBeLessThan(0.2);
  });

  it('ignores common contract filler words when comparing', () => {
    expect(similarity('The Employee shall', 'The Company shall')).toBeLessThan(1);
  });

  it('treats two clauses of pure filler as equivalent rather than crashing', () => {
    expect(similarity('the and of to', 'a an in for')).toBe(1);
  });

  it('is 0 when one side has no meaningful words at all', () => {
    expect(similarity(NOTICE_V1, 'the and of')).toBe(0);
  });

  it('is unaffected by capitalisation and punctuation style', () => {
    expect(similarity(NOTICE_V1, NOTICE_V1.toUpperCase().replace(/\(/g, ' ('))).toBe(1);
  });
});

describe('pairClauses', () => {
  it('pairs clauses that share a label even when the wording was rewritten', () => {
    reset();
    const a = [clause(NOTICE_V1, '6.1')];
    const b = [clause('Either party may end this agreement on one month notice.', '6.1')];

    const pairs = pairClauses(a, b);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a?.id).toBe(a[0]?.id);
    expect(pairs[0]?.b?.id).toBe(b[0]?.id);
  });

  it('pairs similar clauses when neither side is labelled', () => {
    reset();
    const pairs = pairClauses([clause(NOTICE_V1)], [clause(NOTICE_V2)]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a).not.toBeNull();
    expect(pairs[0]?.b).not.toBeNull();
  });

  it('marks an identical clause as unchanged', () => {
    reset();
    const pairs = pairClauses([clause(BOND, '5.2')], [clause(BOND, '5.2')]);
    expect(pairs[0]?.identical).toBe(true);
    expect(unchangedCount(pairs)).toBe(1);
    expect(changedPairs(pairs)).toEqual([]);
  });

  it('treats a whitespace-only difference as unchanged', () => {
    reset();
    const pairs = pairClauses([clause(BOND, '5.2')], [clause(BOND.replace(/ /g, '  '), '5.2')]);
    expect(pairs[0]?.identical).toBe(true);
  });

  it('reports a clause only in the old version as a removal', () => {
    reset();
    const pairs = pairClauses([clause(BOND, '5.2')], [clause(LEAVE, '8.1')]);
    const removed = pairs.find((pair) => pair.b === null);
    expect(removed?.a?.label).toBe('5.2');
    expect(removed?.pairId).toMatch(/-none$/);
  });

  it('reports a clause only in the new version as an addition', () => {
    reset();
    const pairs = pairClauses([clause(BOND, '5.2')], [clause(LEAVE, '8.1')]);
    const added = pairs.find((pair) => pair.a === null);
    expect(added?.b?.label).toBe('8.1');
    expect(added?.pairId).toMatch(/^none-/);
  });

  it('never uses one clause in two pairs', () => {
    reset();
    const a = [clause(NOTICE_V1, '6.1'), clause(NOTICE_V1, '6.2')];
    const b = [clause(NOTICE_V2, '6.1')];

    const pairs = pairClauses(a, b);
    const usedB = pairs.filter((pair) => pair.b !== null).map((pair) => pair.b?.id);
    expect(new Set(usedB).size).toBe(usedB.length);
    expect(pairs.filter((pair) => pair.b === null)).toHaveLength(1);
  });

  it('prefers the labelled match over a textually closer unlabelled one', () => {
    reset();
    const a = [clause(NOTICE_V1, '6.1')];
    const b = [clause(NOTICE_V1, '9.9'), clause('Notice of resignation is now two weeks.', '6.1')];

    const pairs = pairClauses(a, b);
    const matched = pairs.find((pair) => pair.a !== null && pair.b !== null);
    expect(matched?.b?.label).toBe('6.1');
  });

  it('uses the category from the analysis to pair rewritten clauses', () => {
    reset();
    const a = [clause('You must not join a competitor for two years after leaving.')];
    const b = [clause('Post-employment restraints have been removed entirely from this offer.')];
    const categories: Record<string, ClauseCategory> = {
      [a[0]!.id]: 'NON_COMPETE',
      [b[0]!.id]: 'NON_COMPETE',
    };

    const pairs = pairClauses(a, b, categories);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.category).toBe('NON_COMPETE');
  });

  it('falls back to GENERAL when no category is known', () => {
    reset();
    const pairs = pairClauses([clause(BOND, '5.2')], [clause(BOND, '5.2')]);
    expect(pairs[0]?.category).toBe('GENERAL');
  });

  it('orders results by the old document, with additions after', () => {
    reset();
    const a = [clause(NOTICE_V1, '6.1'), clause(BOND, '5.2')];
    const b = [clause(BOND, '5.2'), clause(NOTICE_V2, '6.1'), clause(LEAVE, '8.1')];

    const pairs = pairClauses(a, b);
    expect(pairs[0]?.a?.label).toBe('6.1');
    expect(pairs[1]?.a?.label).toBe('5.2');
    expect(pairs[2]?.a).toBeNull();
  });

  it('handles an empty old document as all additions', () => {
    reset();
    const pairs = pairClauses([], [clause(BOND, '5.2')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a).toBeNull();
  });

  it('handles an empty new document as all removals', () => {
    reset();
    const pairs = pairClauses([clause(BOND, '5.2')], []);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.b).toBeNull();
  });

  it('returns nothing for two empty documents', () => {
    expect(pairClauses([], [])).toEqual([]);
  });

  it('gives every pair a unique id', () => {
    reset();
    const a = [clause(NOTICE_V1, '6.1'), clause(BOND, '5.2'), clause(LEAVE, '8.1')];
    const b = [clause(NOTICE_V2, '6.1'), clause(BOND, '5.2')];

    const ids = pairClauses(a, b).map((pair) => pair.pairId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('changedPairs and unchangedCount', () => {
  it('split a revision into what changed and what did not', () => {
    reset();
    const a = [clause(NOTICE_V1, '6.1'), clause(BOND, '5.2')];
    const b = [clause(NOTICE_V2, '6.1'), clause(BOND, '5.2')];

    const pairs = pairClauses(a, b);
    expect(changedPairs(pairs)).toHaveLength(1);
    expect(unchangedCount(pairs)).toBe(1);
  });

  it('count nothing for an empty comparison', () => {
    expect(changedPairs([])).toEqual([]);
    expect(unchangedCount([])).toBe(0);
  });
});
