import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  LANGUAGES,
  translate,
  type Language,
  type TranslationKey,
  type TranslateParams,
} from '@/i18n';

export type ReadingLevel = 'simple' | 'standard';

export interface Preferences {
  language: Language;
  readingLevel: ReadingLevel;
}

interface PreferencesValue extends Preferences {
  setLanguage: (language: Language) => void;
  setReadingLevel: (level: ReadingLevel) => void;
  t: (key: TranslationKey, params?: TranslateParams) => string;
}

const STORAGE_KEY = 'signsure.prefs';

const PreferencesContext = createContext<PreferencesValue | null>(null);

function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}

/**
 * Reads saved preferences. Preferences are the only thing SignSure persists, and only in
 * sessionStorage - never the document. Storage can throw in private mode, so failures are
 * swallowed and the defaults win.
 */
function readStored(): Preferences {
  const fallback: Preferences = { language: 'en', readingLevel: 'standard' };
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const record = parsed as Record<string, unknown>;
    return {
      language: isLanguage(record.language) ? record.language : fallback.language,
      readingLevel: record.readingLevel === 'simple' ? 'simple' : 'standard',
    };
  } catch {
    return fallback;
  }
}

function persist(prefs: Preferences): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore: preferences are a convenience, not state the app depends on.
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Preferences>(readStored);

  // The page language follows the interface, so a screen reader switches to a Hindi voice
  // instead of reading Devanagari with English pronunciation (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = prefs.language;
  }, [prefs.language]);

  const setLanguage = useCallback((language: Language) => {
    setPrefs((current) => {
      const next = { ...current, language };
      persist(next);
      return next;
    });
  }, []);

  const setReadingLevel = useCallback((readingLevel: ReadingLevel) => {
    setPrefs((current) => {
      const next = { ...current, readingLevel };
      persist(next);
      return next;
    });
  }, []);

  const value = useMemo<PreferencesValue>(
    () => ({
      ...prefs,
      setLanguage,
      setReadingLevel,
      t: (key, params) => translate(prefs.language, key, params),
    }),
    [prefs, setLanguage, setReadingLevel],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error('usePreferences must be used inside <PreferencesProvider>');
  return value;
}

/** Convenience hook for components that only need the translator. */
export function useT(): PreferencesValue['t'] {
  return usePreferences().t;
}
