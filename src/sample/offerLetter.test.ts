import { describe, expect, it } from 'vitest';
import { findMissingInfo, runRules } from '@shared/rules';
import type { CategoryByClauseId } from '@shared/rules';
import type { Clause, ClauseCategory } from '@shared/types';
import { LIMITS } from '@shared/limits';
import { parseText } from '@/features/parsing/parseDocument';
import { SAMPLE_OFFER_LETTER } from './offerLetter';

/**
 * The sample is what a judge will click first, so it is tested like production data: it has to
 * parse, stay inside the payload limits, and actually trigger the findings the demo promises.
 */
function parseSample() {
  const result = parseText(SAMPLE_OFFER_LETTER, 'sample');
  if (!result.ok) throw new Error(`Sample failed to parse: ${result.reason}`);
  return result.document;
}

describe('sample offer letter', () => {
  it('parses into a sensible number of clauses', () => {
    const document = parseSample();
    expect(document.clauses.length).toBeGreaterThan(15);
    expect(document.clauses.length).toBeLessThanOrEqual(LIMITS.maxClauses);
    expect(document.source).toBe('sample');
  });

  it('stays well inside the payload limits so the demo never hits a cap', () => {
    const document = parseSample();
    expect(document.charCount).toBeLessThan(LIMITS.maxTotalChars / 2);
    for (const clause of document.clauses) {
      expect(clause.text.length).toBeLessThanOrEqual(LIMITS.maxClauseChars);
    }
  });

  it('has no page numbers, because it is plain text rather than a PDF', () => {
    const document = parseSample();
    expect(document.pageCount).toBeNull();
    expect(document.clauses.every((clause) => clause.page === null)).toBe(true);
  });

  it('numbers its clauses so citations can name them', () => {
    const labels = parseSample()
      .clauses.map((clause) => clause.label)
      .filter((label): label is string => label !== null);
    expect(labels).toContain('5.2');
    expect(labels).toContain('6.1');
    expect(labels).toContain('10.1');
  });

  it('contains no real-looking personal data', () => {
    expect(SAMPLE_OFFER_LETTER).not.toMatch(/\b\d{4}\s?\d{4}\s?\d{4}\b/); // Aadhaar-like
    expect(SAMPLE_OFFER_LETTER).not.toMatch(/[A-Z]{5}\d{4}[A-Z]/); // PAN-like
    expect(SAMPLE_OFFER_LETTER).not.toMatch(/@/); // no email addresses
    expect(SAMPLE_OFFER_LETTER).not.toMatch(/\+91[\s-]?\d{10}/); // no phone numbers
  });

  describe('the rules a demo depends on', () => {
    /** The categories the model would assign, so the rule engine can be exercised offline. */
    const CATEGORY_BY_LABEL: Readonly<Record<string, ClauseCategory>> = {
      '2.1': 'PROBATION',
      '3.1': 'COMPENSATION',
      '3.2': 'COMPENSATION',
      '3.3': 'GENERAL',
      '5.2': 'BOND_OR_EXIT_PENALTY',
      '6.1': 'NOTICE_PERIOD',
      '6.2': 'TERMINATION',
      '7.1': 'DOCUMENT_RETENTION',
      '8.1': 'CONFIDENTIALITY',
      '9.1': 'IP_ASSIGNMENT',
      '10.1': 'NON_COMPETE',
      '10.2': 'NON_SOLICIT',
      '11.1': 'MOONLIGHTING',
      '12.1': 'DISPUTE_RESOLUTION',
    };

    function sampleCategories(clauses: readonly Clause[]): CategoryByClauseId {
      const categories: Record<string, ClauseCategory> = {};
      for (const clause of clauses) {
        const category = clause.label === null ? undefined : CATEGORY_BY_LABEL[clause.label];
        if (category !== undefined) categories[clause.id] = category;
      }
      return categories;
    }

    it.each([
      'IN-EMP-NONCOMPETE-POST',
      'IN-EMP-BOND',
      'IN-EMP-NOTICE-LONG',
      'IN-EMP-NOTICE-ASYMMETRIC',
      'IN-EMP-DOC-RETENTION',
      'IN-EMP-CLAWBACK',
      'IN-EMP-UNILATERAL-CHANGE',
      'IN-EMP-PROBATION-EXTEND',
      'IN-EMP-WAGES-50',
      'IN-EMP-IP-BROAD',
      'IN-EMP-NONSOLICIT',
      'IN-EMP-JURISDICTION',
    ])('triggers %s', (ruleId) => {
      const document = parseSample();
      const hits = runRules(document.clauses, sampleCategories(document.clauses));
      expect(hits.map((hit) => hit.ruleId)).toContain(ruleId);
    });

    it('reads the bond amount out of the document', () => {
      const document = parseSample();
      const bond = runRules(document.clauses, sampleCategories(document.clauses)).find(
        (hit) => hit.ruleId === 'IN-EMP-BOND',
      );
      expect(bond?.severity).toBe('HIGH');
      expect(bond?.details?.amount).toBe('Rs. 2,00,000');
    });

    it('spots that the employee gives more notice than the company', () => {
      const document = parseSample();
      const asymmetric = runRules(document.clauses, sampleCategories(document.clauses)).find(
        (hit) => hit.ruleId === 'IN-EMP-NOTICE-ASYMMETRIC',
      );
      expect(asymmetric?.details).toEqual({
        yours: 'ninety (90) days',
        theirs: 'thirty (30) days',
      });
    });

    it('produces at least one HIGH-risk rule hit for the demo to open on', () => {
      const document = parseSample();
      const hits = runRules(document.clauses, sampleCategories(document.clauses));
      expect(hits.filter((hit) => hit.severity === 'HIGH').length).toBeGreaterThanOrEqual(3);
      expect(hits[0]?.severity).toBe('HIGH');
    });
  });

  it('is deliberately silent about leave, so the "not stated" path has something to find', () => {
    const document = parseSample();
    const missing = findMissingInfo(document.clauses).map((item) => item.ruleId);
    expect(missing).toContain('IN-EMP-MISSING-LEAVE');
  });

  it('does state the things an offer letter normally states', () => {
    const document = parseSample();
    const missing = findMissingInfo(document.clauses).map((item) => item.ruleId);
    expect(missing).not.toContain('IN-EMP-MISSING-NOTICE');
    expect(missing).not.toContain('IN-EMP-MISSING-SALARY');
    expect(missing).not.toContain('IN-EMP-MISSING-PROBATION');
  });
});
