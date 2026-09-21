import { describe, expect, it } from 'vitest';
import { en, type TranslationKey } from './en';
import { hi } from './hi';
import { translate } from './index';

const KEYS = Object.keys(en) as TranslationKey[];

/**
 * Keys whose Hindi value is deliberately the same as the English one: the product name is a
 * brand, and the two language names must stay readable to the speaker who is looking for them —
 * a switcher that labels a language in a script you cannot read tells you nothing. Everything
 * outside this list must differ from English and must be written in Devanagari.
 */
const SHARED_WITH_ENGLISH: readonly TranslationKey[] = ['app.name', 'lang.en', 'lang.hi'];

const TRANSLATED_KEYS = KEYS.filter((key) => !SHARED_WITH_ENGLISH.includes(key));

const DEVANAGARI = /[\u0900-\u097F]/;

/** Sorted so two strings can be compared as multisets: order around a placeholder may change. */
function placeholdersIn(value: string): string[] {
  return [...(value.match(/\{\w+\}/g) ?? [])].sort((a, b) => a.localeCompare(b));
}

const KEYS_WITH_PLACEHOLDERS = KEYS.filter((key) => placeholdersIn(en[key]).length > 0);

const REPRESENTATIVE_KEYS: readonly TranslationKey[] = [
  'app.tagline',
  'home.cta',
  'risk.high',
  'ask.q.noticePeriod',
  'prepare.questionsForLawyer',
];

describe('the Hindi dictionary', () => {
  it('covers every key in the English dictionary', () => {
    const missing = KEYS.filter((key) => !(key in hi));
    expect(missing).toEqual([]);
  });

  it('defines no key that the English dictionary does not have', () => {
    const extra = Object.keys(hi).filter((key) => !(key in en));
    expect(extra).toEqual([]);
  });

  it('has a non-empty string for every key', () => {
    const blank = KEYS.filter((key) => hi[key].trim() === '');
    expect(blank).toEqual([]);
  });

  it('leaves no value sitting at its untranslated English text', () => {
    const untranslated = TRANSLATED_KEYS.filter((key) => hi[key] === en[key]);
    expect(untranslated).toEqual([]);
  });

  it('writes every translated value in Devanagari', () => {
    const withoutDevanagari = TRANSLATED_KEYS.filter((key) => !DEVANAGARI.test(hi[key]));
    expect(withoutDevanagari).toEqual([]);
  });

  it('keeps the product name and the language names in their own script', () => {
    expect(hi['app.name']).toBe('SignSure');
    expect(hi['lang.en']).toBe('English');
    expect(hi['lang.hi']).toBe(en['lang.hi']);
  });

  describe('placeholders', () => {
    it.each(KEYS_WITH_PLACEHOLDERS)('survive translation unchanged in %s', (key) => {
      expect(placeholdersIn(hi[key])).toEqual(placeholdersIn(en[key]));
    });

    it('finds a placeholder in every key that is expected to carry one', () => {
      // Guards the it.each above: if the filter ever matched nothing, those cases would silently
      // stop running rather than fail.
      expect(KEYS_WITH_PLACEHOLDERS.length).toBeGreaterThan(10);
    });
  });

  describe('through translate', () => {
    it.each(REPRESENTATIVE_KEYS)(
      'returns the Hindi string for %s and the English one for en',
      (key) => {
        expect(translate('hi', key)).toBe(hi[key]);
        expect(translate('en', key)).toBe(en[key]);
      },
    );

    it('substitutes numbers into a Hindi template whose word order differs from English', () => {
      const sentence = translate('hi', 'upload.parsedPages', { clauses: 32, pages: 5 });
      expect(sentence).toContain('32');
      expect(sentence).toContain('5');
      expect(sentence).not.toContain('{');
    });

    it('repeats a placeholder as often as the Hindi sentence needs it', () => {
      const sentence = translate('hi', 'upload.truncated', { pages: 40 });
      expect(sentence.match(/40/g)).toHaveLength(2);
      expect(sentence).not.toContain('{');
    });
  });

  it('carries the caution strings in Hindi rather than falling back to English', () => {
    // These are the strings that must never silently appear in English to a Hindi-first reader:
    // the disclaimer, the footer note about consulting an advocate, and the risk labels that
    // tell them how seriously to take a clause.
    const cautionKeys: readonly TranslationKey[] = [
      'app.disclaimerShort',
      'app.disclaimerLink',
      'app.footerNote',
      'rule.generalInfo',
      'ask.needsProfessionalStatus',
      'overview.noRedFlags',
      'risk.high',
      'risk.medium',
      'risk.low',
      'risk.info',
    ];

    for (const key of cautionKeys) {
      expect(hi[key].trim(), `${key} must be translated`).not.toBe('');
      expect(hi[key], `${key} must not be the English string`).not.toBe(en[key]);
      expect(DEVANAGARI.test(hi[key]), `${key} must be in Devanagari`).toBe(true);
    }
  });
});
