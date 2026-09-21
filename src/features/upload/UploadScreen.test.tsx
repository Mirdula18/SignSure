import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '@/api/client';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { UploadScreen } from './UploadScreen';
import { Dropzone } from './Dropzone';
import { TurnstileWidget, type TurnstileState } from './TurnstileWidget';
import { renderWithPreferences, renderWithProviders } from '@/test/factories';
import { useAppState } from '@/state/appState';

const api = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, ...api };
});

type RenderOptions = Parameters<NonNullable<Window['turnstile']>['render']>[1];

/** A stand-in for Cloudflare's widget that lets each test decide how the check goes. */
function installTurnstile(behaviour: (options: RenderOptions) => void) {
  const remove = vi.fn();
  window.turnstile = {
    render: (_container, options) => {
      behaviour(options);
      return 'widget-1';
    },
    remove,
  };
  return { remove };
}

/** Shows the reducer state the screen produced, so tests can assert on what it dispatched. */
function StateProbe() {
  const { state } = useAppState();
  return (
    <output aria-label="state">
      {state.stage}|{state.sessionStatus}|{state.document?.source ?? 'none'}
    </output>
  );
}

beforeEach(() => {
  api.createSession.mockReset();
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-site-key');
});

afterEach(() => {
  delete window.turnstile;
  vi.unstubAllEnvs();
});

describe('UploadScreen', () => {
  it('reads the built-in sample without any file', async () => {
    installTurnstile(() => undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <UploadScreen />
        <StateProbe />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /try with a sample offer letter/i }));
    expect(screen.getByLabelText('state')).toHaveTextContent('lenses|pending|sample');
  });

  it('says clearly that the sample is made up', () => {
    installTurnstile(() => undefined);
    renderWithProviders(<UploadScreen />);
    expect(screen.getByText(/synthetic - not a real company or person/i)).toBeInTheDocument();
  });

  it('reads pasted text', async () => {
    installTurnstile(() => undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <UploadScreen />
        <StateProbe />
      </>,
    );
    await user.click(screen.getByRole('button', { name: /paste the text/i }));
    const pasteButton = screen.getByRole('button', { name: /read this text/i });
    expect(pasteButton).toBeDisabled();

    await user.type(
      screen.getByLabelText(/paste your offer letter/i),
      '1. The Employee shall give ninety days notice of resignation to the Company.',
    );
    await user.click(pasteButton);
    expect(screen.getByLabelText('state')).toHaveTextContent('lenses|pending|paste');
  });

  it('marks which input mode is active for assistive technology', async () => {
    installTurnstile(() => undefined);
    const user = userEvent.setup();
    renderWithProviders(<UploadScreen />);
    expect(screen.getByRole('button', { name: /upload a file/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: /paste the text/i }));
    expect(screen.getByRole('button', { name: /paste the text/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('explains a rejected file in words that say how to fix it', async () => {
    installTurnstile(() => undefined);
    const user = userEvent.setup({ applyAccept: false });
    renderWithProviders(<UploadScreen />);
    await user.upload(
      screen.getByLabelText(/choose a file/i, { selector: 'input' }),
      new File(['x'], 'photo.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /PDF, Word \(\.docx\) and plain text files\. This one is \.png/,
    );
  });

  it('reads an uploaded text file', async () => {
    installTurnstile(() => undefined);
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <UploadScreen />
        <StateProbe />
      </>,
    );
    await user.upload(
      screen.getByLabelText(/choose a file/i, { selector: 'input' }),
      new File(['1. The Employee shall give ninety days notice.'], 'offer.txt', {
        type: 'text/plain',
      }),
    );
    await waitFor(() => {
      expect(screen.getByLabelText('state')).toHaveTextContent('lenses|pending|txt');
    });
  });

  it('records a session once the security check passes', async () => {
    installTurnstile((options) => {
      options.callback('turnstile-token');
    });
    api.createSession.mockResolvedValue({ token: 'session', expiresAt: 1 });
    renderWithProviders(
      <>
        <UploadScreen />
        <StateProbe />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('state')).toHaveTextContent('upload|ready|none');
    });
    expect(api.createSession).toHaveBeenCalledWith('turnstile-token');
  });

  it('records a failed session so a later analysis can say so immediately', async () => {
    installTurnstile((options) => {
      options.callback('turnstile-token');
    });
    api.createSession.mockRejectedValue(new Error('nope'));
    renderWithProviders(
      <>
        <UploadScreen />
        <StateProbe />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('state')).toHaveTextContent('upload|failed|none');
    });
  });

  it('records a failed security check', async () => {
    installTurnstile((options) => {
      options['error-callback']?.();
    });
    renderWithProviders(
      <>
        <UploadScreen />
        <StateProbe />
      </>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText('state')).toHaveTextContent('upload|failed|none');
    });
  });

  it('has no axe violations', async () => {
    installTurnstile(() => undefined);
    const { container } = renderWithProviders(<UploadScreen />);
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe('Dropzone', () => {
  it('opens the real file picker from a button, so dragging is never the only way', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<Dropzone onFile={vi.fn()} />);
    const input = screen.getByLabelText(/choose a file/i, { selector: 'input' });
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: /choose a file/i }));
    expect(click).toHaveBeenCalled();
  });

  it('accepts a dropped file and highlights while one is dragged over', () => {
    const onFile = vi.fn();
    const { container } = renderWithPreferences(<Dropzone onFile={onFile} />);
    const zone = container.firstElementChild as HTMLElement;
    const file = new File(['x'], 'offer.txt');

    act(() => {
      zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    });
    expect(zone.className).toContain('border-primary');

    act(() => {
      zone.dispatchEvent(new Event('dragleave', { bubbles: true }));
    });
    expect(zone.className).not.toContain('border-primary');

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: { item: () => file } } });
    act(() => {
      zone.dispatchEvent(drop);
    });
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it('ignores drops while disabled', () => {
    const onFile = vi.fn();
    const { container } = renderWithPreferences(<Dropzone onFile={onFile} disabled />);
    const zone = container.firstElementChild as HTMLElement;

    act(() => {
      zone.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
    });
    expect(zone.className).not.toContain('border-primary');

    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', {
      value: { files: { item: () => new File(['x'], 'a.txt') } },
    });
    act(() => {
      zone.dispatchEvent(drop);
    });
    expect(onFile).not.toHaveBeenCalled();
  });

  it('lets the same file be chosen twice in a row', async () => {
    const onFile = vi.fn();
    const user = userEvent.setup();
    renderWithPreferences(<Dropzone onFile={onFile} />);
    const input = screen.getByLabelText<HTMLInputElement>(/choose a file/i, { selector: 'input' });
    const file = new File(['x'], 'offer.txt', { type: 'text/plain' });

    await user.upload(input, file);
    await user.upload(input, file);
    expect(onFile).toHaveBeenCalledTimes(2);
    expect(input.value).toBe('');
  });

  it('describes the accepted formats and size', () => {
    renderWithPreferences(<Dropzone onFile={vi.fn()} />);
    expect(
      screen.getByLabelText(/choose a file/i, { selector: 'input' }),
    ).toHaveAccessibleDescription(/PDF, Word \(\.docx\) or plain text, up to 10 MB/);
  });
});

describe('TurnstileWidget', () => {
  it('hands over the token when the check passes', async () => {
    installTurnstile((options) => {
      options.callback('abc');
    });
    const states: TurnstileState[] = [];
    const { onToken } = renderWithPreferencesWidget((state) => states.push(state));
    await waitFor(() => {
      expect(onToken).toHaveBeenCalledWith('abc');
    });
    expect(states).toContain('ready');
  });

  it('reports failure when the widget errors, with a visible explanation', async () => {
    installTurnstile((options) => {
      options['error-callback']?.();
    });
    renderWithPreferencesWidget();
    expect(await screen.findByText(/security check did not pass/i)).toBeInTheDocument();
  });

  it('goes back to waiting when a token expires', async () => {
    const states: TurnstileState[] = [];
    installTurnstile((options) => {
      options.callback('first');
      options['expired-callback']?.();
    });
    renderWithPreferencesWidget((state) => states.push(state));
    await waitFor(() => {
      expect(states).toEqual(['ready', 'loading']);
    });
  });

  it('fails rather than silently waving visitors through when a production build has no key', async () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    vi.stubEnv('DEV', false);
    const states: TurnstileState[] = [];
    renderWithPreferencesWidget((state) => states.push(state));
    await waitFor(() => {
      expect(states).toContain('failed');
    });
  });

  it('loads the Cloudflare script once when it is not already on the page', async () => {
    const states: TurnstileState[] = [];
    const { unmount } = renderWithPreferencesWidget((state) => states.push(state));
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
    const { remove } = installTurnstile(() => undefined);
    const { unmount } = renderWithPreferencesWidget();
    await waitFor(() => {
      expect(screen.getByText(/quick automatic check/i)).toBeInTheDocument();
    });
    unmount();
    expect(remove).toHaveBeenCalledWith('widget-1');
  });

  // The widget uses `t()`, so it needs the preferences provider like every other component.
  function renderWithPreferencesWidget(onStateChange?: (state: TurnstileState) => void) {
    const onToken = vi.fn();
    const utils = renderWithPreferences(
      <TurnstileWidget
        onToken={onToken}
        {...(onStateChange === undefined ? {} : { onStateChange })}
      />,
    );
    return { ...utils, onToken };
  }
});
