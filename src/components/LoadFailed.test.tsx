import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { LoadFailed } from './LoadFailed';
import { PreferencesProvider } from '@/state/preferences';

describe('LoadFailed', () => {
  it('announces the failure at once, with what happened and what to do', () => {
    render(
      <PreferencesProvider>
        <LoadFailed onReload={vi.fn()} />
      </PreferencesProvider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/did not load/i);
    // Honest about the cost of reloading: the document is not kept anywhere.
    expect(alert).toHaveTextContent(/add it again/i);
  });

  it('reloads the page from a real button', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    render(
      <PreferencesProvider>
        <LoadFailed onReload={onReload} />
      </PreferencesProvider>,
    );
    await user.click(screen.getByRole('button', { name: /reload the page/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('reloads the window when no handler is given', async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    // jsdom's location cannot navigate, so stand in one whose reload can be observed.
    vi.stubGlobal('location', { reload });
    try {
      render(
        <PreferencesProvider>
          <LoadFailed />
        </PreferencesProvider>,
      );
      await user.click(screen.getByRole('button', { name: /reload the page/i }));
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has no accessibility violations', async () => {
    const { container } = render(
      <PreferencesProvider>
        <LoadFailed onReload={vi.fn()} />
      </PreferencesProvider>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
