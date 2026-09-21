import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import App from '@/App';
import { AppStateProvider } from '@/state/appState';
import { PreferencesProvider } from '@/state/preferences';
import { clause, parsedDocument, renderWithProviders } from '@/test/factories';

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

    // No session in a unit test, so the report waits in its busy state for one.
    expect(screen.getByRole('heading', { level: 1, name: /your report/i })).toBeInTheDocument();
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
