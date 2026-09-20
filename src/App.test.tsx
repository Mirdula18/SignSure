import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import App from '@/App';
import { PreferencesProvider } from '@/state/preferences';

function renderApp() {
  return render(
    <PreferencesProvider>
      <App />
    </PreferencesProvider>,
  );
}

describe('App shell', () => {
  it('exposes the skip link as the first focusable element', () => {
    renderApp();
    expect(screen.getByRole('link', { name: /skip to main content/i })).toBeInTheDocument();
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

  it('has no axe violations', async () => {
    const { container } = renderApp();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
