import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { SubmitEvent } from 'react';
import { Button, type ButtonVariant } from './Button';

const VARIANTS: readonly ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger'];

describe('Button', () => {
  it('defaults to type="button"', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('does not submit a surrounding form by accident, which a bare <button> would', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    render(
      <form aria-label="Question" onSubmit={onSubmit}>
        <Button>Show a suggestion</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Show a suggestion' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still submits when a form asks for a submit button explicitly', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: SubmitEvent) => {
      event.preventDefault();
    });
    render(
      <form aria-label="Question" onSubmit={onSubmit}>
        <Button type="submit">Ask</Button>
      </form>,
    );
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it.each(VARIANTS)(
    'renders the %s variant as a working button with the full-size tap target',
    async (variant) => {
      const user = userEvent.setup();
      const onClick = vi.fn();
      render(
        <Button variant={variant} onClick={onClick}>
          Continue
        </Button>,
      );
      const button = screen.getByRole('button', { name: 'Continue' });
      // Every variant keeps the 44px target, because most readers are on a phone.
      expect(button).toHaveClass('tap-target');
      await user.click(button);
      expect(onClick).toHaveBeenCalledTimes(1);
    },
  );

  it('gives each variant a different look', () => {
    render(
      <>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {variant}
          </Button>
        ))}
      </>,
    );
    const classes = VARIANTS.map(
      (variant) => screen.getByRole('button', { name: variant }).className,
    );
    expect(new Set(classes).size).toBe(VARIANTS.length);
  });

  it('ignores clicks while disabled, so an action cannot run twice while it is in flight', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Analyse
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Analyse' });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('passes other attributes through and merges an extra class', () => {
    render(
      <>
        <p id="copy-hint">Copies the sheet as text.</p>
        <Button aria-describedby="copy-hint" aria-pressed="true" className="w-full" name="copy">
          Copy
        </Button>
      </>,
    );
    const button = screen.getByRole('button', { name: 'Copy', pressed: true });
    expect(button).toHaveAccessibleDescription('Copies the sheet as text.');
    expect(button).toHaveAttribute('name', 'copy');
    expect(button).toHaveClass('w-full', 'tap-target');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <>
        {VARIANTS.map((variant) => (
          <Button key={variant} variant={variant}>
            {`A ${variant} button`}
          </Button>
        ))}
        <Button disabled>A disabled button</Button>
      </>,
    );
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
