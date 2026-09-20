import { en, type Dictionary, type TranslationKey } from './en';

export type Language = 'en' | 'hi';

export const LANGUAGES: readonly Language[] = ['en', 'hi'] as const;

const dictionaries: Record<Language, Dictionary> = {
  en,
  // Hindi is filled in during the accessibility phase; falling back to English keeps the UI
  // usable instead of showing raw keys.
  hi: en,
};

export type TranslateParams = Readonly<Record<string, string | number>>;

/**
 * Looks up a string and substitutes `{placeholders}`.
 *
 * Returns the key itself if a translation is missing so a gap is visible in tests and in the
 * UI rather than rendering an empty element.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  params?: TranslateParams,
): string {
  const template = dictionaries[language][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

export { en };
export type { TranslationKey, Dictionary };
