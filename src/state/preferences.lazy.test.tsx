import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as I18n from '@/i18n';
import { PreferencesProvider, usePreferences, useT } from './preferences';

/**
 * The provider's side of loading Hindi on demand. The loader is controlled here, so each test
 * decides when - or whether - the dictionary arrives.
 */
const loader = vi.hoisted(() => ({
  loaded: false,
  release: (): void => undefined,
  fail: (): void => undefined,
}));

vi.mock('@/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof I18n>();
  return {
    ...actual,
    isLanguageLoaded: (language: 'en' | 'hi') => language === 'en' || loader.loaded,
    loadLanguage: () =>
      new Promise<void>((resolve, reject) => {
        loader.release = () => {
          loader.loaded = true;
          resolve();
        };
        loader.fail = () => {
          reject(new TypeError('Failed to fetch dynamically imported module'));
        };
      }),
  };
});

function Probe() {
  const { language, setLanguage } = usePreferences();
  const t = useT();
  return (
    <div>
      <p data-testid="language">{language}</p>
      <p data-testid="text">{t('error.heading')}</p>
      <button
        type="button"
        onClick={() => {
          setLanguage('hi');
        }}
      >
        hindi
      </button>
      <button
        type="button"
        onClick={() => {
          setLanguage('en');
        }}
      >
        english
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <PreferencesProvider>
      <Probe />
    </PreferencesProvider>,
  );
}

beforeEach(() => {
  loader.loaded = false;
  sessionStorage.clear();
  document.documentElement.lang = 'en';
});

describe('choosing a language that has not loaded yet', () => {
  it('stays in English until the dictionary arrives, then switches the text and the page language', async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole('button', { name: 'hindi' }));
    expect(screen.getByTestId('language')).toHaveTextContent('en');
    expect(screen.getByTestId('text')).toHaveTextContent('That did not work');

    loader.release();
    expect(await screen.findByText('यह नहीं हो पाया')).toBeInTheDocument();
    expect(screen.getByTestId('language')).toHaveTextContent('hi');
    expect(document.documentElement.lang).toBe('hi');
  });

  it('keeps a later choice when the earlier language finishes loading afterwards', async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole('button', { name: 'hindi' }));
    await user.click(screen.getByRole('button', { name: 'english' }));
    loader.release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId('language')).toHaveTextContent('en');
    expect(screen.getByTestId('text')).toHaveTextContent('That did not work');
  });

  it('stays in English, without an error, when the dictionary cannot be fetched', async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole('button', { name: 'hindi' }));
    loader.fail();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByTestId('language')).toHaveTextContent('en');
  });
});

describe('a saved language that has not loaded yet', () => {
  it('opens in English with a matching page language, then switches once Hindi arrives', async () => {
    sessionStorage.setItem('signsure.prefs', JSON.stringify({ language: 'hi' }));
    renderProbe();

    expect(screen.getByTestId('language')).toHaveTextContent('en');
    expect(document.documentElement.lang).toBe('en');

    loader.release();
    expect(await screen.findByText('यह नहीं हो पाया')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('hi');
  });
});
