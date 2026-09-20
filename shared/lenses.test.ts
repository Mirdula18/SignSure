import { describe, expect, it } from 'vitest';
import {
  categoryWeight,
  findingScore,
  LENS_DEFINITIONS,
  LENSES,
  prioritisedCategories,
  rankFindings,
  suggestedQuestionKeys,
  type Lens,
} from './lenses';
import type { ClauseCategory, RiskLevel } from './types';

function finding(clauseId: string, risk: RiskLevel, category: ClauseCategory) {
  return { clauseId, risk, category };
}

describe('LENS_DEFINITIONS', () => {
  it('defines every lens exactly once, keyed by its own id', () => {
    for (const lens of LENSES) {
      expect(LENS_DEFINITIONS[lens].id).toBe(lens);
    }
    expect(Object.keys(LENS_DEFINITIONS)).toHaveLength(LENSES.length);
  });

  it('never lists a category as both primary and secondary for one lens', () => {
    for (const lens of LENSES) {
      const { primary, secondary } = LENS_DEFINITIONS[lens];
      expect(primary.filter((category) => secondary.includes(category))).toEqual([]);
    }
  });

  it('offers suggested questions for every lens', () => {
    for (const lens of LENSES) {
      expect(LENS_DEFINITIONS[lens].questionKeys.length).toBeGreaterThan(0);
    }
  });
});

describe('categoryWeight', () => {
  it('weights a primary category above a secondary one', () => {
    expect(categoryWeight(['QUIT_EARLY'], 'BOND_OR_EXIT_PENALTY')).toBeGreaterThan(
      categoryWeight(['QUIT_EARLY'], 'TERMINATION'),
    );
  });

  it('gives an unrelated category no weight', () => {
    expect(categoryWeight(['QUIT_EARLY'], 'IP_ASSIGNMENT')).toBe(0);
  });

  it('takes the strongest weight across several chosen lenses', () => {
    expect(categoryWeight(['SALARY', 'GETTING_FIRED'], 'TERMINATION')).toBe(
      categoryWeight(['GETTING_FIRED'], 'TERMINATION'),
    );
  });

  it('treats "everything" as an even, non-zero weight for all categories', () => {
    expect(categoryWeight(['EVERYTHING'], 'IP_ASSIGNMENT')).toBe(
      categoryWeight(['EVERYTHING'], 'NOTICE_PERIOD'),
    );
    expect(categoryWeight(['EVERYTHING'], 'OTHER')).toBeGreaterThan(0);
  });

  it('falls back to "everything" when nothing is selected', () => {
    expect(categoryWeight([], 'IP_ASSIGNMENT')).toBe(
      categoryWeight(['EVERYTHING'], 'IP_ASSIGNMENT'),
    );
  });
});

describe('findingScore', () => {
  it('ranks risk above relevance', () => {
    const relevantButLow = findingScore(['QUIT_EARLY'], 'LOW', 'BOND_OR_EXIT_PENALTY');
    const irrelevantButHigh = findingScore(['QUIT_EARLY'], 'HIGH', 'IP_ASSIGNMENT');
    expect(irrelevantButHigh).toBeGreaterThan(relevantButLow);
  });
});

describe('rankFindings', () => {
  it('puts high risk first regardless of the chosen concerns', () => {
    const ranked = rankFindings(
      [finding('c002', 'LOW', 'BOND_OR_EXIT_PENALTY'), finding('c001', 'HIGH', 'IP_ASSIGNMENT')],
      ['QUIT_EARLY'],
    );
    expect(ranked.map((f) => f.clauseId)).toEqual(['c001', 'c002']);
  });

  it('breaks ties within a risk level by relevance to the concern', () => {
    const ranked = rankFindings(
      [finding('c010', 'MEDIUM', 'IP_ASSIGNMENT'), finding('c011', 'MEDIUM', 'NOTICE_PERIOD')],
      ['QUIT_EARLY'],
    );
    expect(ranked[0]?.clauseId).toBe('c011');
  });

  it('is stable: equal findings keep document order', () => {
    const ranked = rankFindings(
      [
        finding('c030', 'MEDIUM', 'NOTICE_PERIOD'),
        finding('c020', 'MEDIUM', 'NOTICE_PERIOD'),
        finding('c010', 'MEDIUM', 'NOTICE_PERIOD'),
      ],
      ['QUIT_EARLY'],
    );
    expect(ranked.map((f) => f.clauseId)).toEqual(['c010', 'c020', 'c030']);
  });

  it('does not mutate its input', () => {
    const input = [finding('c002', 'LOW', 'GENERAL'), finding('c001', 'HIGH', 'GENERAL')];
    const copy = [...input];
    rankFindings(input, ['EVERYTHING']);
    expect(input).toEqual(copy);
  });

  it('handles an empty list', () => {
    expect(rankFindings([], ['EVERYTHING'])).toEqual([]);
  });
});

describe('prioritisedCategories', () => {
  it('lists primary categories before secondary ones', () => {
    const categories = prioritisedCategories(['QUIT_EARLY']);
    expect(categories.slice(0, 2)).toEqual(['NOTICE_PERIOD', 'BOND_OR_EXIT_PENALTY']);
    expect(categories).toContain('TERMINATION');
  });

  it('de-duplicates categories shared by two lenses', () => {
    const categories = prioritisedCategories(['QUIT_EARLY', 'GETTING_FIRED']);
    expect(new Set(categories).size).toBe(categories.length);
  });

  it('returns nothing to prioritise for "everything", so the model weighs all clauses', () => {
    expect(prioritisedCategories(['EVERYTHING'])).toEqual([]);
    expect(prioritisedCategories(['QUIT_EARLY', 'EVERYTHING'])).toEqual([]);
    expect(prioritisedCategories([])).toEqual([]);
  });
});

describe('suggestedQuestionKeys', () => {
  it('collects keys from each chosen lens without duplicates', () => {
    const keys = suggestedQuestionKeys(['QUIT_EARLY', 'FUTURE_JOBS']);
    expect(keys).toContain('ask.q.noticePeriod');
    expect(keys).toContain('ask.q.joinCompetitor');
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('falls back to the general questions when nothing is selected', () => {
    expect(suggestedQuestionKeys([])).toEqual(suggestedQuestionKeys(['EVERYTHING']));
  });

  it.each(LENSES)('returns at least one question for %s', (lens: Lens) => {
    expect(suggestedQuestionKeys([lens]).length).toBeGreaterThan(0);
  });
});
