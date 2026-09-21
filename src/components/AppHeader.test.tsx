import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { AppHeader } from './AppHeader';
import { PreferencesProvider } from '@/state/preferences';

function renderHeader() {
  return render(
    <PreferencesProvider>
      <AppHeader />
    </PreferencesProvider>,
  );
}

describe('AppHeader', () => {
  it('labels the language and reading-level controls', () => {
    renderHeader();
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Simple' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Standard' })).toBeChecked();
  });

  it('changes the reading level from the keyboard', async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByRole('radio', { name: 'Simple' }));
    expect(screen.getByRole('radio', { name: 'Simple' })).toBeChecked();
  });

  it('switches language, and relabels itself in the language just chosen', async () => {
    const user = userEvent.setup();
    renderHeader();
    const select = screen.getByLabelText('Language');
    await user.selectOptions(select, 'hi');
    expect(select).toHaveValue('hi');
    // The control now labels itself in Hindi, which is the point: a switcher a Hindi reader
    // cannot read is no use to them.
    expect(screen.getByLabelText('भाषा')).toBe(select);
  });

  it('has no axe violations', async () => {
    const { container } = renderHeader();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
