import { usePreferences } from '@/state/preferences';
import { LANGUAGES, type Language } from '@/i18n';

/**
 * Site header. Language and reading level live here (and only here) so that WCAG 3.2.6
 * "consistent help" holds: the same controls sit in the same place on every screen.
 */
export function AppHeader() {
  const { t, language, setLanguage, readingLevel, setReadingLevel } = usePreferences();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <a href="#main" className="flex items-center gap-2 text-lg font-semibold text-ink">
          <span aria-hidden="true" className="text-primary">
            ✓
          </span>
          {t('app.name')}
        </a>

        <div className="ms-auto flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="pref-language" className="text-sm text-muted">
              {t('lang.label')}
            </label>
            <select
              id="pref-language"
              className="tap-target rounded-md border border-line-strong bg-surface px-2 py-1 text-sm text-ink"
              value={language}
              onChange={(event) => {
                setLanguage(event.target.value as Language);
              }}
            >
              {LANGUAGES.map((code) => (
                <option key={code} value={code}>
                  {t(code === 'en' ? 'lang.en' : 'lang.hi')}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="flex items-center gap-2">
            <legend className="sr-only">{t('readingLevel.label')}</legend>
            <span aria-hidden="true" className="text-sm text-muted">
              {t('readingLevel.label')}
            </span>
            {(['simple', 'standard'] as const).map((level) => (
              <label
                key={level}
                className="tap-target flex cursor-pointer items-center gap-1 rounded-md border border-line px-2 py-1 text-sm has-checked:border-primary has-checked:bg-primary-soft"
              >
                <input
                  type="radio"
                  name="reading-level"
                  value={level}
                  checked={readingLevel === level}
                  onChange={() => {
                    setReadingLevel(level);
                  }}
                />
                {t(level === 'simple' ? 'readingLevel.simple' : 'readingLevel.standard')}
              </label>
            ))}
          </fieldset>
        </div>
      </div>
    </header>
  );
}
