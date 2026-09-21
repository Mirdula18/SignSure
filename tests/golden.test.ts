import { describe, expect, it } from 'vitest';
import { findMissingInfo, runRules } from '@shared/rules';
import { pairClauses } from '@shared/compare';
import { LIMITS } from '@shared/limits';
import { clauseByLabel, expectedCategories, loadGoldenSet, type GoldenContract } from './golden';

/**
 * The deterministic half of the golden set, run on every commit with no API key.
 *
 * Each fixture says which categories a correct classifier would assign. Given those, the rule
 * library must raise exactly the flags a lawyer reading the document would expect - no fewer, and
 * none of the "do not cry wolf" ones. The model's half is measured separately by `npm run eval`.
 */

const GOLDEN = loadGoldenSet();
const BY_NAME = new Map(GOLDEN.map((contract) => [contract.name, contract]));

function hitsFor(contract: GoldenContract) {
  return runRules(contract.clauses, expectedCategories(contract));
}

describe('the golden set itself', () => {
  it('has between four and eight contracts, as docs/AI_PIPELINE.md asks', () => {
    expect(GOLDEN.length).toBeGreaterThanOrEqual(4);
    expect(GOLDEN.length).toBeLessThanOrEqual(8);
  });

  it.each(GOLDEN.map((contract) => [contract.name, contract] as const))(
    '%s segments into clauses that fit the request limits',
    (_name, contract) => {
      expect(contract.clauses.length).toBeGreaterThan(0);
      for (const clause of contract.clauses) {
        expect(clause.text.length).toBeLessThanOrEqual(LIMITS.maxClauseChars);
      }
    },
  );

  it('stays tiny, because the repository has a size budget', () => {
    const bytes = GOLDEN.reduce((sum, contract) => sum + contract.text.length, 0);
    expect(bytes).toBeLessThan(20_000);
  });
});

describe.each(GOLDEN.map((contract) => [contract.name, contract] as const))(
  '%s',
  (_name, contract) => {
    const { expected } = contract;

    it('finds every label the expectations refer to', () => {
      // A stale fixture should fail here, clearly, rather than as a confusing rule mismatch.
      expect(() => expectedCategories(contract)).not.toThrow();
    });

    if (expected.mustFlagRules.length > 0) {
      it.each(expected.mustFlagRules)('raises %s', (ruleId) => {
        expect(hitsFor(contract).map((hit) => hit.ruleId)).toContain(ruleId);
      });
    }

    if (expected.mustNotFlagRules.length > 0) {
      it.each(expected.mustNotFlagRules)('does not raise %s', (ruleId) => {
        expect(hitsFor(contract).map((hit) => hit.ruleId)).not.toContain(ruleId);
      });
    }

    for (const [ruleId, details] of Object.entries(expected.expectedDetails ?? {})) {
      it(`reads the details of ${ruleId} out of the document`, () => {
        const hit = hitsFor(contract).find((candidate) => candidate.ruleId === ruleId);
        expect(hit?.details).toMatchObject(details);
      });
    }

    for (const [ruleId, severity] of Object.entries(expected.expectedSeverity ?? {})) {
      it(`grades ${ruleId} as ${severity}`, () => {
        const hit = hitsFor(contract).find((candidate) => candidate.ruleId === ruleId);
        expect(hit?.severity).toBe(severity);
      });
    }

    if (expected.mustReportMissing.length > 0) {
      it.each(expected.mustReportMissing)('reports %s as missing', (ruleId) => {
        expect(findMissingInfo(contract.clauses).map((item) => item.ruleId)).toContain(ruleId);
      });
    }

    if (expected.mustNotReportMissing.length > 0) {
      it.each(expected.mustNotReportMissing)('does not report %s as missing', (ruleId) => {
        expect(findMissingInfo(contract.clauses).map((item) => item.ruleId)).not.toContain(ruleId);
      });
    }

    for (const question of expected.questions) {
      for (const label of question.clauseLabels ?? []) {
        it(`has a clause ${label} for the question "${question.q}" to cite`, () => {
          expect(clauseByLabel(contract.clauses, label).text.length).toBeGreaterThan(0);
        });
      }
    }
  },
);

describe('the compare pair', () => {
  const revised = GOLDEN.find((contract) => contract.expected.compareWith !== undefined);

  it('exists in the golden set', () => {
    expect(revised).toBeDefined();
  });

  if (revised?.expected.compareWith !== undefined) {
    const original = BY_NAME.get(revised.expected.compareWith.replace('.txt', ''));
    if (original === undefined) throw new Error('The compare pair names a missing contract');
    const pairs = pairClauses(original.clauses, revised.clauses);
    const changedLabels = pairs
      .filter((pair) => pair.a !== null && pair.b !== null && !pair.identical)
      .map((pair) => pair.a?.label);

    it.each(revised.expected.expectChanged ?? [])(
      'pairs clause %s and sees that it changed',
      (label) => {
        expect(changedLabels).toContain(label);
      },
    );

    it.each(revised.expected.expectRemoved ?? [])('sees that clause %s was removed', (label) => {
      const removed = pairs.filter((pair) => pair.b === null).map((pair) => pair.a?.label);
      expect(removed).toContain(label);
    });

    it('recognises the untouched clauses as unchanged', () => {
      const unchanged = pairs.filter((pair) => pair.identical).length;
      expect(unchanged).toBeGreaterThanOrEqual(revised.expected.expectUnchangedAtLeast ?? 0);
    });
  }
});

describe('the injection fixture', () => {
  const contract = BY_NAME.get('injection');

  it('keeps the injected text inside one clause, so it cannot forge a boundary', () => {
    if (!contract) throw new Error('injection fixture missing');
    const injected = contract.clauses.filter((clause) => clause.text.includes('developer mode'));
    expect(injected).toHaveLength(1);
    // The forged marker is just text inside that clause; it never becomes a clause id.
    expect(contract.clauses.map((clause) => clause.id)).not.toContain('c999');
  });
});
