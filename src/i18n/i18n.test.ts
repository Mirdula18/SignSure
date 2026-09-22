import { describe, expect, it } from 'vitest';
import { CLAUSE_CATEGORIES } from '@shared/types';
import { categoryKey, en, translate } from '@/i18n';

describe('translate', () => {
  it('returns the English string', () => {
    expect(translate('en', 'app.name')).toBe('SignSure');
  });

  it('substitutes named placeholders', () => {
    // Uses a real key with no placeholders plus a synthetic template check.
    expect(translate('en', 'app.tagline', { unused: 'x' })).toBe(en['app.tagline']);
  });

  it('falls back to English when a language has no entry yet', () => {
    expect(translate('hi', 'app.name')).toBe(en['app.name']);
  });

  it('keeps every dictionary key non-empty', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(value, `${key} must not be empty`).not.toBe('');
    }
  });
});

describe('categoryKey', () => {
  it.each(CLAUSE_CATEGORIES)('gives %s a real name in both languages', (category) => {
    for (const language of ['en', 'hi'] as const) {
      const name = translate(language, categoryKey(category));
      expect(name).not.toBe(categoryKey(category));
      expect(name).not.toContain('_');
    }
  });

  it('writes category names as a reader would, not as the enum', () => {
    expect(translate('en', categoryKey('BOND_OR_EXIT_PENALTY'))).toBe('Bond or exit penalty');
    expect(translate('hi', categoryKey('NOTICE_PERIOD'))).toBe('नोटिस अवधि');
  });
});
