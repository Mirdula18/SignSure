import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '@/api/client';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import App from '@/App';
import { AppStateProvider } from '@/state/appState';
import { PreferencesProvider } from '@/state/preferences';
import { analysis, clause, parsedDocument, renderWithProviders } from '@/test/factories';
import {
  installTurnstile,
  uninstallTurnstile,
  type TurnstileRenderOptions,
} from '@/test/turnstile';

const api = vi.hoisted(() => ({ createSession: vi.fn(), analyzeDocument: vi.fn() }));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, ...api };
});

afterEach(() => {
  uninstallTurnstile();
  api.createSession.mockReset();
  api.analyzeDocument.mockReset();
});

/** The report is loaded on demand; a cold module cache can take longer than the default 1 s. */
const LAZY_WAIT = { timeout: 5_000 };

function renderApp() {
  return render(
    <PreferencesProvider>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </PreferencesProvider>,
  );
}

describe('App shell', () => {
  it('exposes the skip link as the first focusable element', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole('link', { name: /skip to main content/i }),
    );
  });

  it('shows the disclaimer on every screen', () => {
    renderApp();
    expect(screen.getAllByText(/not legal advice/i).length).toBeGreaterThan(0);
  });

  it('renders landmarks and a single level-one heading', () => {
    renderApp();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('opens on the upload screen with a way in that needs no file', () => {
    renderApp();
    expect(
      screen.getByRole('button', { name: /try with a sample offer letter/i }),
    ).toBeInTheDocument();
  });

  it('offers both a file and a paste route, because PDFs do not always extract', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /upload a file/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /paste the text/i })).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderApp();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe('App stages', () => {
  it('moves from the sample to the concern picker, reporting what it found', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));

    expect(
      screen.getByRole('heading', { level: 1, name: /what are you most worried about/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/We found \d+ clauses\./)).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('reports pages when the document has them', () => {
    renderWithProviders(<App />, {
      stage: 'lenses',
      document: parsedDocument([clause(), clause({ id: 'c002', order: 1 })]),
    });
    expect(screen.getByText('We found 2 clauses across 3 pages.')).toBeInTheDocument();
  });

  it('goes back to the start from the concern picker', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    await user.click(screen.getByRole('button', { name: /^back$/i }));
    expect(
      screen.getByRole('heading', { level: 1, name: /understand every clause/i }),
    ).toBeInTheDocument();
  });

  it('starts the analysis with the chosen concerns', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    await user.click(screen.getByRole('checkbox', { name: /i might quit early/i }));
    await user.click(screen.getByRole('button', { name: /analyse my document/i }));

    // The report's code loads on demand. No session in a unit test, so once it arrives the
    // report waits in its busy state for one.
    expect(
      await screen.findByRole('heading', { level: 1, name: /your report/i }, LAZY_WAIT),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /your report/i })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('offers to clear everything once a document is loaded', async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    await user.click(screen.getByRole('button', { name: /clear everything/i }));
    expect(
      screen.getByRole('heading', { level: 1, name: /understand every clause/i }),
    ).toBeInTheDocument();
  });
});

describe('App security check', () => {
  it('does not run on the home page, only once there is a document to analyse', async () => {
    const { render: renderWidget } = installTurnstile();
    const user = userEvent.setup();
    renderApp();
    expect(renderWidget).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    await waitFor(() => {
      expect(renderWidget).toHaveBeenCalledTimes(1);
    });
  });

  it('survives a reader who presses Analyse before the check has finished', async () => {
    // The check takes a second or two. It used to live on the upload screen, so choosing the
    // sample straight away tore it down and the report waited for a session forever.
    let pending: TurnstileRenderOptions | null = null;
    const { render: renderWidget, remove } = installTurnstile((options) => {
      pending = options;
    });
    api.createSession.mockResolvedValue({ token: 'session-token', expiresAt: 1 });
    api.analyzeDocument.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    await user.click(screen.getByRole('button', { name: /analyse my document/i }));
    await screen.findByRole('heading', { level: 1, name: /your report/i }, LAZY_WAIT);

    // Same widget, never removed, across the move from concerns to report.
    expect(renderWidget).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();

    act(() => {
      pending?.callback('turnstile-token');
    });
    await waitFor(() => {
      expect(api.analyzeDocument).toHaveBeenCalledWith(
        'session-token',
        expect.anything(),
        expect.anything(),
      );
    });
    expect(api.createSession).toHaveBeenCalledWith('turnstile-token');
  });
});

describe('App focus and announcements', () => {
  it('moves focus to each new screen heading, so keyboard users are not left at the top', async () => {
    installTurnstile();
    api.analyzeDocument.mockReturnValue(new Promise(() => undefined));
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }));
    });
    expect(document.activeElement).toHaveTextContent(/what are you most worried about/i);

    await user.click(screen.getByRole('button', { name: /analyse my document/i }));
    const report = await screen.findByRole(
      'heading',
      { level: 1, name: /your report/i },
      LAZY_WAIT,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(report);
    });

    await user.click(screen.getByRole('button', { name: /clear everything/i }));
    await waitFor(() => {
      expect(document.activeElement).toHaveTextContent(/understand every clause/i);
    });
  });

  it('keeps focus on the report heading when the analysis finishes, and says the report is ready', async () => {
    installTurnstile((options) => {
      options.callback('turnstile-token');
    });
    api.createSession.mockResolvedValue({ token: 'session-token', expiresAt: 1 });
    let finish: (value: ReturnType<typeof analysis>) => void = () => undefined;
    api.analyzeDocument.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    await user.click(screen.getByRole('button', { name: /analyse my document/i }));
    const heading = await screen.findByRole(
      'heading',
      { level: 1, name: /your report/i },
      LAZY_WAIT,
    );
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    expect(screen.queryByText('Your report is ready.')).not.toBeInTheDocument();

    await act(async () => {
      finish(analysis());
      await Promise.resolve();
    });
    await screen.findByRole('tab', { name: /overview/i });
    // The same heading element, still focused: the reader has not been moved.
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText('Your report is ready.')).toBeInTheDocument();
  });

  it('does not move focus on first load, so the skip link stays the first stop', () => {
    renderApp();
    expect(document.activeElement).toBe(document.body);
  });
});
