import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { UploadScreen } from './UploadScreen';
import { Dropzone } from './Dropzone';
import { renderWithPreferences, renderWithProviders } from '@/test/factories';
import { useAppState } from '@/state/appState';

/** Shows the reducer state the screen produced, so tests can assert on what it dispatched. */
function StateProbe() {
  const { state } = useAppState();
  return (
    <output aria-label="state">
      {state.stage}|{state.sessionStatus}|{state.document?.source ?? 'none'}
    </output>
  );
}

describe('UploadScreen', () => {
  it('reads the built-in sample without any file', async () => {
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

  it('does not start the security check, so reading the home page never contacts Cloudflare', () => {
    renderWithProviders(<UploadScreen />);
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
    expect(screen.queryByText(/quick automatic check/i)).not.toBeInTheDocument();
  });

  it('says clearly that the sample is made up', () => {
    renderWithProviders(<UploadScreen />);
    expect(screen.getByText(/synthetic - not a real company or person/i)).toBeInTheDocument();
  });

  it('reads pasted text', async () => {
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

  it('has no axe violations', async () => {
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

  it('describes the accepted formats and size on the button a reader actually uses', () => {
    renderWithPreferences(<Dropzone onFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: /choose a file/i })).toHaveAccessibleDescription(
      /PDF, Word \(\.docx\) or plain text, up to 10 MB/,
    );
  });

  it('keeps the hidden file input out of the tab order, so there is no invisible stop', async () => {
    const user = userEvent.setup();
    renderWithPreferences(<Dropzone onFile={vi.fn()} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /choose a file/i }));
  });
});
