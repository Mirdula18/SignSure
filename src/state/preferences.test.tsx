import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PreferencesProvider, usePreferences, useT } from './preferences';

function Probe() {
  const { language, readingLevel, setLanguage, setReadingLevel } = usePreferences();
  const t = useT();
  return (
    <div>
      <p data-testid="state">{`${language}/${readingLevel}`}</p>
      <p data-testid="translated">{t('app.name')}</p>
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
          setReadingLevel('simple');
        }}
      >
        simple
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

describe('PreferencesProvider', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to English and the standard reading level', () => {
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('en/standard');
  });

  it('exposes a translator bound to the current language', () => {
    renderProbe();
    expect(screen.getByTestId('translated')).toHaveTextContent('SignSure');
  });

  it('sets the page language, so a screen reader uses a Hindi voice for Hindi text', async () => {
    const user = userEvent.setup();
    renderProbe();
    expect(document.documentElement.lang).toBe('en');
    await user.click(screen.getByRole('button', { name: 'hindi' }));
    expect(document.documentElement.lang).toBe('hi');
  });

  it('persists changes to sessionStorage only', async () => {
    const user = userEvent.setup();
    renderProbe();
    await user.click(screen.getByRole('button', { name: 'hindi' }));
    await user.click(screen.getByRole('button', { name: 'simple' }));

    expect(screen.getByTestId('state')).toHaveTextContent('hi/simple');
    expect(JSON.parse(sessionStorage.getItem('signsure.prefs') ?? '{}')).toEqual({
      language: 'hi',
      readingLevel: 'simple',
    });
    expect(localStorage.length).toBe(0);
  });

  it('restores saved preferences on mount', () => {
    sessionStorage.setItem(
      'signsure.prefs',
      JSON.stringify({ language: 'hi', readingLevel: 'simple' }),
    );
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('hi/simple');
  });

  it.each([
    ['not json at all', 'en/standard'],
    [JSON.stringify(null), 'en/standard'],
    [JSON.stringify({ language: 'fr', readingLevel: 'wild' }), 'en/standard'],
    [JSON.stringify('a string'), 'en/standard'],
  ])('ignores unusable stored values (%s)', (stored, expected) => {
    sessionStorage.setItem('signsure.prefs', stored);
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent(expected);
  });

  it('still renders when storage throws, as in private browsing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const user = userEvent.setup();
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('en/standard');
    await user.click(screen.getByRole('button', { name: 'hindi' }));
    expect(screen.getByTestId('state')).toHaveTextContent('hi/standard');
  });

  it('throws a helpful error when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/must be used inside/);
    spy.mockRestore();
  });
});
