import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import App from '@/App';
import { AppStateProvider } from '@/state/appState';
import { PreferencesProvider } from '@/state/preferences';

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
