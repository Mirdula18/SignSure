import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { TurnstileWidget, type TurnstileState } from './TurnstileWidget';
import { renderWithPreferences } from '@/test/factories';
import { installTurnstile, uninstallTurnstile } from '@/test/turnstile';

beforeEach(() => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
});

afterEach(() => {
  uninstallTurnstile();
  vi.unstubAllEnvs();
});

// The widget uses `t()`, so it needs the preferences provider like every other component.
function renderWidget(onStateChange?: (state: TurnstileState) => void) {
  const onToken = vi.fn();
  const utils = renderWithPreferences(
    <TurnstileWidget
      onToken={onToken}
      {...(onStateChange === undefined ? {} : { onStateChange })}
    />,
  );
  return { ...utils, onToken };
}

describe('TurnstileWidget', () => {
  it('hands over the token when the check passes', async () => {
    installTurnstile((options) => {
      options.callback('abc');
    });
    const states: TurnstileState[] = [];
    const { onToken } = renderWidget((state) => states.push(state));
    await waitFor(() => {
      expect(onToken).toHaveBeenCalledWith('abc');
    });
    expect(states).toContain('ready');
  });

  it('reports failure when the widget errors, with a visible explanation', async () => {
    installTurnstile((options) => {
      options['error-callback']?.();
    });
    renderWidget();
    expect(await screen.findByText(/security check did not pass/i)).toBeInTheDocument();
  });

  it('goes back to waiting when a token expires', async () => {
    const states: TurnstileState[] = [];
    installTurnstile((options) => {
      options.callback('first');
      options['expired-callback']?.();
    });
    renderWidget((state) => states.push(state));
    await waitFor(() => {
      expect(states).toEqual(['ready', 'loading']);
    });
  });

  it('fails rather than silently waving visitors through when a production build has no key', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('DEV', false);
    const states: TurnstileState[] = [];
    renderWidget((state) => states.push(state));
    await waitFor(() => {
      expect(states).toContain('failed');
    });
  });

  it('loads the Cloudflare script once when it is not already on the page', async () => {
    const states: TurnstileState[] = [];
    const { unmount } = renderWidget((state) => states.push(state));
    const script = document.querySelector<HTMLScriptElement>(
      'script[src*="challenges.cloudflare.com"]',
    );
    expect(script).not.toBeNull();

    // Simulate the script failing to load, as it would offline.
    act(() => {
      script?.dispatchEvent(new Event('error'));
    });
    await waitFor(() => {
      expect(states).toContain('failed');
    });
    unmount();
    script?.remove();
  });

  it('removes the widget when it goes away', async () => {
    const { remove } = installTurnstile();
    const { unmount } = renderWidget();
    await waitFor(() => {
      expect(screen.getByText(/quick automatic check/i)).toBeInTheDocument();
    });
    unmount();
    expect(remove).toHaveBeenCalledWith('widget-1');
  });
});
