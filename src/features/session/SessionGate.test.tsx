import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '@/api/client';
import { screen, waitFor } from '@testing-library/react';
import { SessionGate } from './SessionGate';
import { renderWithProviders } from '@/test/factories';
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
});

describe('SessionGate', () => {
  it('asks for a session as soon as it is mounted', async () => {
    api.createSession.mockResolvedValue({ token: 'session', expiresAt: 1 });
    renderGate();
    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('ready');
    });
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });

  it('records a refused session so a waiting analysis can say so at once', async () => {
    api.createSession.mockRejectedValue(new Error('nope'));
    renderGate();
    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('failed');
    });
  });

  it('stays pending while the request is in flight', () => {
    api.createSession.mockReturnValue(new Promise(() => undefined));
    renderGate();
    expect(screen.getByLabelText('session')).toHaveTextContent('pending');
  });

  it('asks only once, however often the effect is re-run', async () => {
    // Every mount costs one of the ten sessions an address gets in ten minutes, and React runs
    // effects twice in development, so a second request here would halve the real budget.
    api.createSession.mockResolvedValue({ token: 'session', expiresAt: 1 });
    const { rerender } = renderGate();
    rerender(
      <>
        <SessionGate />
        <SessionProbe />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('ready');
    });
    expect(api.createSession).toHaveBeenCalledTimes(1);
  });

  it('renders nothing of its own: there is no check for the reader to pass', () => {
    api.createSession.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<SessionGate />);
    expect(container).toBeEmptyDOMElement();
  });
});
