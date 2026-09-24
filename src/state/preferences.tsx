import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  LANGUAGES,
  isLanguageLoaded,
  loadLanguage,
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

/**
 * Saved preferences, except a language whose dictionary has not arrived yet: that one starts in
 * English and is switched to as soon as it loads, so the page never mixes two languages and
 * `lang` always matches the text on screen.
 */
function initialPreferences(): { prefs: Preferences; pending: Language | null } {
  const stored = readStored();
  if (isLanguageLoaded(stored.language)) return { prefs: stored, pending: null };
  return { prefs: { ...stored, language: 'en' }, pending: stored.language };
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initialPreferences);
  const [prefs, setPrefs] = useState<Preferences>(initial.prefs);

  // The page language follows the interface, so a screen reader switches to a Hindi voice
  // instead of reading Devanagari with English pronunciation (WCAG 3.1.1).
  useEffect(() => {
    document.documentElement.lang = prefs.language;
  }, [prefs.language]);

  const applyLanguage = useCallback((language: Language) => {
    setPrefs((current) => {
      const next = { ...current, language };
      persist(next);
      return next;
    });
  }, []);

  // The language asked for last, so a slow load cannot override a later choice.
  const requested = useRef<Language>(initial.prefs.language);

  /**
   * Loads `language` and switches to it, unless the reader has chosen something else meanwhile.
   * If it cannot load - offline, before the service worker has it - the interface stays as is.
   */
  const loadThenApply = useCallback(
    (language: Language) => {
      loadLanguage(language).then(
        () => {
          if (requested.current === language) applyLanguage(language);
        },
        () => undefined,
      );
    },
    [applyLanguage],
  );

  /** Switches at once when the dictionary is on hand, otherwise once it has loaded. */
  const setLanguage = useCallback(
    (language: Language) => {
      requested.current = language;
      if (isLanguageLoaded(language)) applyLanguage(language);
      else loadThenApply(language);
    },
    [applyLanguage, loadThenApply],
  );

  useEffect(() => {
    if (initial.pending === null) return;
    requested.current = initial.pending;
    loadThenApply(initial.pending);
  }, [initial.pending, loadThenApply]);

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
