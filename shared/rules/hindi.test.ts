import { describe, expect, it } from 'vitest';
import type { MissingInfoHit, RuleHit } from '../types';
import { EMPLOYMENT_RULES, MISSING_INFO_RULES } from './employment';
import { MISSING_INFO_TEXT_HI, RULE_TEXT_HI } from './hindi';
import { localiseHit, localiseMissingInfo, notStatedLine, ruleQuestions } from './index';

const DEVANAGARI = /\p{Script=Devanagari}/u;

/**
 * The Hindi equivalents of the English cautious-language checks in `employment.test.ts`: no
 * definite legal conclusion about the reader's clause, and no advice on whether to sign.
 */
const FORBIDDEN_HI = [
  'शून्य है',
  'अवैध है',
  'ग़ैरक़ानूनी है',
  'लागू नहीं किया जा सकता',
  'साइन करें',
  'साइन न करें',
  'साइन मत करें',
  'हस्ताक्षर करें',
  'हस्ताक्षर न करें',
];

function hit(ruleId: string): RuleHit {
  return {
    ruleId,
    clauseId: 'c001',
    severity: 'HIGH',
    title: 'English title',
    message: 'English message.',
    basis: 'Indian Contract Act, 1872, s.27.',
    questions: ['English question one?', 'English question two?'],
    lastReviewed: '2026-09-20',
  };
}

function missing(ruleId: string): MissingInfoHit {
  return { ruleId, label: 'Notice period', question: 'What is the notice period?' };
}

describe('the Hindi rule text', () => {
  it('translates every rule in the library, with the same number of questions', () => {
    for (const rule of EMPLOYMENT_RULES) {
      const hindi = RULE_TEXT_HI[rule.id];
      expect(hindi, rule.id).toBeDefined();
      expect(hindi?.questions.length, rule.id).toBe(rule.questions.length);
    }
  });

  it('has no entry for a rule that does not exist', () => {
    const ids = new Set(EMPLOYMENT_RULES.map((rule) => rule.id));
    expect(Object.keys(RULE_TEXT_HI).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('translates every missing-information check, and nothing else', () => {
    expect(Object.keys(MISSING_INFO_TEXT_HI).sort()).toEqual(
      MISSING_INFO_RULES.map((rule) => rule.id).sort(),
    );
  });

  it('writes every title, message, question and label in Devanagari', () => {
    const texts = [
      ...Object.values(RULE_TEXT_HI).flatMap((text) => [
        text.title,
        text.message,
        ...text.questions,
      ]),
      ...Object.values(MISSING_INFO_TEXT_HI).flatMap((text) => [text.label, text.question]),
    ];
    for (const text of texts) expect(text, text).toMatch(DEVANAGARI);
  });

  it('never states a legal conclusion as certain, or says whether to sign', () => {
    for (const [id, text] of Object.entries(RULE_TEXT_HI)) {
      const all = [text.title, text.message, ...text.questions].join(' ');
      for (const phrase of FORBIDDEN_HI) expect(`${id}: ${all}`).not.toContain(phrase);
    }
  });
});

describe('localiseHit', () => {
  it('leaves an English reader with the English text', () => {
    const original = hit('IN-EMP-BOND');
    expect(localiseHit(original, 'en')).toBe(original);
  });

  it('swaps in the reviewed Hindi title, message and questions, but keeps the basis as cited', () => {
    const localised = localiseHit(hit('IN-EMP-BOND'), 'hi');
    expect(localised.title).toBe(RULE_TEXT_HI['IN-EMP-BOND']?.title);
    expect(localised.message).toMatch(DEVANAGARI);
    expect(localised.questions).toEqual(RULE_TEXT_HI['IN-EMP-BOND']?.questions);
    expect(localised.basis).toBe('Indian Contract Act, 1872, s.27.');
  });

  it('keeps the English for a rule with no translation rather than hiding it', () => {
    const unknown = hit('IN-EMP-NOT-A-RULE');
    expect(localiseHit(unknown, 'hi')).toBe(unknown);
  });
});

describe('localiseMissingInfo', () => {
  it('translates a known item for a Hindi reader and leaves English alone', () => {
    const item = missing('IN-EMP-MISSING-NOTICE');
    expect(localiseMissingInfo(item, 'en')).toBe(item);
    expect(localiseMissingInfo(item, 'hi')).toEqual({
      ruleId: 'IN-EMP-MISSING-NOTICE',
      label: 'नोटिस अवधि',
      question: 'मेरे लिए और कंपनी के लिए नोटिस अवधि कितनी है?',
    });
  });

  it('keeps the English for an item with no translation', () => {
    const unknown = missing('IN-EMP-MISSING-NOTHING');
    expect(localiseMissingInfo(unknown, 'hi')).toBe(unknown);
  });
});

describe('notStatedLine', () => {
  it('says the document is silent, in the reader language', () => {
    const item = missing('IN-EMP-MISSING-NOTICE');
    expect(notStatedLine(item, 'en')).toBe('Notice period: not stated in this document.');
    expect(notStatedLine(item, 'hi')).toBe('नोटिस अवधि: इस डॉक्यूमेंट में नहीं लिखा है।');
  });
});

describe('ruleQuestions in Hindi', () => {
  it('collects the reviewed Hindi questions, once each', () => {
    const questions = ruleQuestions([hit('IN-EMP-BOND'), hit('IN-EMP-BOND')], 'hi');
    expect(questions).toEqual(RULE_TEXT_HI['IN-EMP-BOND']?.questions);
  });
});
