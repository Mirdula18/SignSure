import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { ReactElement } from 'react';
import { LENSES, type Lens } from '@shared/lenses';
import { LensPicker } from './LensPicker';
import { PreferencesProvider } from '@/state/preferences';

function renderWith(ui: ReactElement) {
  return render(<PreferencesProvider>{ui}</PreferencesProvider>);
}

const TITLES: Readonly<Record<Lens, string>> = {
  QUIT_EARLY: 'I might quit early',
  FUTURE_JOBS: 'My next job',
  SALARY: 'My salary',
  GETTING_FIRED: 'Being let go',
  EVERYTHING: 'Show me everything',
};

const HINTS: Readonly<Record<Lens, string>> = {
  QUIT_EARLY: 'Notice period, bonds, what leaving would cost you',
  FUTURE_JOBS: 'Non-compete, non-solicit, confidentiality',
  SALARY: 'CTC breakup, variable pay, deductions, clawbacks',
  GETTING_FIRED: 'Termination, probation, notice from the company',
  EVERYTHING: 'No particular focus',
};

const HEADING = 'What are you most worried about?';
const ANALYSE = 'Analyse my document';

/** Finds a lens checkbox by its title, however the hint is attached to it. */
function checkbox(lens: Lens): HTMLElement {
  return screen.getByRole('checkbox', { name: new RegExp(`^${TITLES[lens]}`) });
}

describe('LensPicker', () => {
  it('shows the step as a page heading labelling its section', () => {
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1, name: HEADING })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: HEADING })).toBeInTheDocument();
  });

  it('groups one real checkbox per lens in a fieldset named by its legend', () => {
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    const group = screen.getByRole('group', { name: HEADING });
    expect(group.tagName).toBe('FIELDSET');
    expect(within(group).getAllByRole('checkbox')).toHaveLength(LENSES.length);
  });

  it.each(LENSES)(
    'labels the %s checkbox with its title and describes it with its hint',
    (lens) => {
      renderWith(<LensPicker onSubmit={vi.fn()} />);
      const box = checkbox(lens);
      expect(box).toHaveAccessibleName(expect.stringContaining(TITLES[lens]));
      expect(box).toHaveAccessibleDescription(HINTS[lens]);
      expect(box).not.toBeChecked();
    },
  );

  // Suspected bug: the hint sits inside the <label> *and* is the aria-describedby target, so a
  // screen reader reads it twice - once as part of the name, then again as the description.
  // The name should be the title alone.
  it('names each checkbox by its title alone, so the hint is not read out twice', () => {
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    expect(checkbox('QUIT_EARLY')).toHaveAccessibleName(TITLES.QUIT_EARLY);
  });

  it('checks and unchecks a lens when it is clicked', async () => {
    const user = userEvent.setup();
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    await user.click(checkbox('SALARY'));
    expect(checkbox('SALARY')).toBeChecked();
    await user.click(checkbox('SALARY'));
    expect(checkbox('SALARY')).not.toBeChecked();
  });

  it('toggles from the keyboard with Space, as a native checkbox should', async () => {
    const user = userEvent.setup();
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    checkbox('FUTURE_JOBS').focus();
    await user.keyboard(' ');
    expect(checkbox('FUTURE_JOBS')).toBeChecked();
  });

  it('allows several specific concerns at once', async () => {
    const user = userEvent.setup();
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    await user.click(checkbox('QUIT_EARLY'));
    await user.click(checkbox('SALARY'));
    expect(checkbox('QUIT_EARLY')).toBeChecked();
    expect(checkbox('SALARY')).toBeChecked();
  });

  it('clears the specific concerns when "Show me everything" is chosen, since the two contradict', async () => {
    const user = userEvent.setup();
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    await user.click(checkbox('QUIT_EARLY'));
    await user.click(checkbox('SALARY'));
    await user.click(checkbox('EVERYTHING'));
    expect(checkbox('EVERYTHING')).toBeChecked();
    expect(checkbox('QUIT_EARLY')).not.toBeChecked();
    expect(checkbox('SALARY')).not.toBeChecked();
  });

  it('clears "Show me everything" when a specific concern is chosen', async () => {
    const user = userEvent.setup();
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    await user.click(checkbox('EVERYTHING'));
    await user.click(checkbox('GETTING_FIRED'));
    expect(checkbox('GETTING_FIRED')).toBeChecked();
    expect(checkbox('EVERYTHING')).not.toBeChecked();
  });

  it('can uncheck "Show me everything" and leave nothing chosen', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWith(<LensPicker onSubmit={onSubmit} />);
    await user.click(checkbox('EVERYTHING'));
    await user.click(checkbox('EVERYTHING'));
    expect(checkbox('EVERYTHING')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: ANALYSE }));
    expect(onSubmit).toHaveBeenCalledWith([]);
  });

  it('submits the chosen lenses in the order they were picked', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWith(<LensPicker onSubmit={onSubmit} />);
    await user.click(checkbox('SALARY'));
    await user.click(checkbox('QUIT_EARLY'));
    await user.click(screen.getByRole('button', { name: ANALYSE }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(['SALARY', 'QUIT_EARLY']);
  });

  it('pre-checks the lenses it was given, so coming back keeps the earlier choice', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWith(<LensPicker initial={['FUTURE_JOBS', 'SALARY']} onSubmit={onSubmit} />);
    expect(checkbox('FUTURE_JOBS')).toBeChecked();
    expect(checkbox('SALARY')).toBeChecked();
    expect(checkbox('QUIT_EARLY')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: ANALYSE }));
    expect(onSubmit).toHaveBeenCalledWith(['FUTURE_JOBS', 'SALARY']);
  });

  it('offers Back only when there is somewhere to go back to', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const { unmount } = renderWith(<LensPicker onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    unmount();

    renderWith(<LensPicker onSubmit={vi.fn()} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('disables the analyse button while submitting, so the analysis cannot start twice', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWith(<LensPicker onSubmit={onSubmit} submitting />);
    const analyse = screen.getByRole('button', { name: ANALYSE });
    expect(analyse).toBeDisabled();
    await user.click(analyse);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('keeps the analyse button enabled by default', () => {
    renderWith(<LensPicker onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: ANALYSE })).toBeEnabled();
  });

  it('has no axe violations', async () => {
    const { container } = renderWith(
      <LensPicker initial={['QUIT_EARLY']} onSubmit={vi.fn()} onBack={vi.fn()} />,
    );
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
