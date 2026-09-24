import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The Hindi dictionary is fetched on demand. The test setup preloads it for every other file, so
 * these tests take a fresh copy of the module to see the app as a first visitor does.
 */
async function freshI18n() {
  vi.resetModules();
  return import('@/i18n');
}

describe('loading a language on demand', () => {
  afterEach(() => {
    vi.doUnmock('./hi');
    vi.resetModules();
  });

  it('starts with English only, and shows English rather than a raw key for Hindi until it loads', async () => {
    const i18n = await freshI18n();
    expect(i18n.isLanguageLoaded('en')).toBe(true);
    expect(i18n.isLanguageLoaded('hi')).toBe(false);
    expect(i18n.translate('hi', 'error.heading')).toBe('That did not work');
  });

  it('shows Hindi once it has loaded', async () => {
    const i18n = await freshI18n();
    await i18n.loadLanguage('hi');
    expect(i18n.isLanguageLoaded('hi')).toBe(true);
    expect(i18n.translate('hi', 'error.heading')).toBe('यह नहीं हो पाया');
  });

  it('does nothing for a language that is already on hand', async () => {
    const i18n = await freshI18n();
    await i18n.loadLanguage('en');
    expect(i18n.isLanguageLoaded('hi')).toBe(false);
  });

  it('rejects when the chunk cannot be fetched, and stays in English', async () => {
    vi.doMock('./hi', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const i18n = await freshI18n();
    await expect(i18n.loadLanguage('hi')).rejects.toThrow();
    expect(i18n.isLanguageLoaded('hi')).toBe(false);
    expect(i18n.translate('hi', 'error.heading')).toBe('That did not work');
  });
});
