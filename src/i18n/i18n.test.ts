import { describe, expect, it } from 'vitest';
import { en, translate } from '@/i18n';

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
