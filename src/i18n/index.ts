import type { ClauseCategory } from '@shared/types';
import { en, type Dictionary, type TranslationKey } from './en';

export type Language = 'en' | 'hi';

export const LANGUAGES: readonly Language[] = ['en', 'hi'] as const;

/**
 * Dictionaries on hand. English ships with the first screen; Hindi is the largest single file in
 * the app and most readers never choose it, so it arrives only when someone does
 * (`loadLanguage`). Hindi is typed against the English dictionary, so every key is present once
 * it has loaded.
 */
const dictionaries: Partial<Record<Language, Dictionary>> = { en };

/** True once `language` can be rendered without falling back to English. */
export function isLanguageLoaded(language: Language): boolean {
  return dictionaries[language] !== undefined;
}

/**
 * Fetches a language's dictionary, once. Rejects if its chunk cannot be fetched, so the caller
 * can stay in the language it has rather than switch to one it cannot show.
 */
export async function loadLanguage(language: Language): Promise<void> {
  if (isLanguageLoaded(language)) return;
  dictionaries.hi = (await import('./hi')).hi;
}

export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * The dictionary key for a clause category's display name.
 *
 * Typed against the dictionary, so a category without a translation fails the type check instead
 * of showing the raw enum (or an English label in the Hindi interface).
 */
export function categoryKey(category: ClauseCategory): TranslationKey {
  return `category.${category}`;
}

/**
 * Looks up a string and substitutes `{placeholders}`.
 *
 * Falls back to English when a language has not loaded or lacks a key, and to the key itself if
 * even English lacks it, so a gap is visible in tests and in the UI rather than rendering an
 * empty element.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  params?: TranslateParams,
): string {
  const template = dictionaries[language]?.[key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export { en };
export type { TranslationKey, Dictionary };
