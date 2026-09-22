import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '@/api/client';
import { screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { SessionGate } from './SessionGate';
import { renderWithProviders } from '@/test/factories';
import { installTurnstile, uninstallTurnstile } from '@/test/turnstile';
import { useAppState } from '@/state/appState';

const api = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, ...api };
});

/** Shows the session state the gate produced. */
function SessionProbe() {
  const { state } = useAppState();
  return <output aria-label="session">{state.sessionStatus}</output>;
}

function renderGate() {
  return renderWithProviders(
    <>
      <SessionGate />
      <SessionProbe />
    </>,
  );
}

beforeEach(() => {
  api.createSession.mockReset();
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
});

afterEach(() => {
  uninstallTurnstile();
  vi.unstubAllEnvs();
});

describe('SessionGate', () => {
  it('exchanges a passed check for a session', async () => {
    installTurnstile((options) => {
      options.callback('turnstile-token');
    });
    api.createSession.mockResolvedValue({ token: 'session', expiresAt: 1 });
    renderGate();
    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('ready');
    });
    expect(api.createSession).toHaveBeenCalledWith('turnstile-token');
  });

  it('records a refused session so a waiting analysis can say so at once', async () => {
    installTurnstile((options) => {
      options.callback('turnstile-token');
    });
    api.createSession.mockRejectedValue(new Error('nope'));
    renderGate();
    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('failed');
    });
  });

  it('records a failed security check without asking for a session', async () => {
    installTurnstile((options) => {
      options['error-callback']?.();
    });
    renderGate();
    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('failed');
    });
    expect(api.createSession).not.toHaveBeenCalled();
  });

  it('stays pending while the check is still running', () => {
    installTurnstile();
    renderGate();
    expect(screen.getByLabelText('session')).toHaveTextContent('pending');
    expect(screen.getByText(/quick automatic check/i)).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    installTurnstile();
    const { container } = renderGate();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
