import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { useState } from 'react';
import { Tabs, type TabDefinition } from './Tabs';

type Section = 'overview' | 'clauses' | 'ask' | 'compare';

const TABS: readonly TabDefinition<Section>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'clauses', label: 'Clauses' },
  { id: 'ask', label: 'Ask' },
  { id: 'compare', label: 'Compare' },
];

interface HarnessProps {
  tabs?: readonly TabDefinition<Section>[];
  initial?: Section;
  onSelect?: (id: Section) => void;
}

/** Owns `selected`, as the report does, so choosing a tab really changes the panel. */
function Harness({ tabs = TABS, initial = 'overview', onSelect }: HarnessProps) {
  const [selected, setSelected] = useState<Section>(initial);
  return (
    <Tabs
      tabs={tabs}
      selected={selected}
      onSelect={(id) => {
        setSelected(id);
        onSelect?.(id);
      }}
      label="Report sections"
    >
      <p>{`Content for ${selected}`}</p>
      <button type="button">{`Action in ${selected}`}</button>
    </Tabs>
  );
}

function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name });
}

describe('Tabs', () => {
  it('exposes a labelled tablist of tabs and one tabpanel', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Report sections' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
  });

  it('marks only the selected tab as selected', () => {
    render(<Harness initial="clauses" />);
    expect(tab('Clauses')).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Overview', 'Ask', 'Compare']) {
      expect(tab(name)).toHaveAttribute('aria-selected', 'false');
    }
  });

  it('ties the selected tab and the panel together in both directions', () => {
    render(<Harness />);
    const panel = screen.getByRole('tabpanel');
    expect(tab('Overview')).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', tab('Overview').id);
    // So a screen reader names the panel after its tab.
    expect(screen.getByRole('tabpanel', { name: 'Overview' })).toBe(panel);
  });

  it('gives every tab its own id and panel id', () => {
    render(<Harness />);
    const tabs = screen.getAllByRole('tab');
    expect(new Set(tabs.map((item) => item.id)).size).toBe(tabs.length);
    expect(new Set(tabs.map((item) => item.getAttribute('aria-controls'))).size).toBe(tabs.length);
  });

  it('uses a roving tabindex: only the selected tab is in the tab order', () => {
    render(<Harness initial="ask" />);
    expect(tab('Ask').tabIndex).toBe(0);
    for (const name of ['Overview', 'Clauses', 'Compare']) {
      expect(tab(name).tabIndex).toBe(-1);
    }
  });

  it('lets Tab move past the tablist into the panel instead of through every tab', async () => {
    const user = userEvent.setup();
    render(<Harness initial="clauses" />);
    await user.tab();
    expect(tab('Clauses')).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Action in clauses' })).toHaveFocus();
  });

  it('selects a tab on click and shows its panel', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.click(tab('Compare'));
    expect(onSelect).toHaveBeenCalledWith('compare');
    expect(tab('Compare')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Compare').tabIndex).toBe(0);
    expect(tab('Overview').tabIndex).toBe(-1);
    expect(screen.getByRole('tabpanel', { name: 'Compare' })).toHaveTextContent(
      'Content for compare',
    );
  });

  it('moves selection and focus with ArrowRight and ArrowLeft', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(tab('Overview'));
    await user.keyboard('{ArrowRight}');
    expect(tab('Clauses')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Clauses')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tab('Ask')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Clauses')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Clauses')).toHaveFocus();
  });

  it('wraps from the last tab to the first and back again', async () => {
    const user = userEvent.setup();
    render(<Harness initial="compare" />);
    await user.click(tab('Compare'));
    await user.keyboard('{ArrowRight}');
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Overview')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Compare')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Compare')).toHaveFocus();
  });

  it('jumps to the first and last tabs with Home and End', async () => {
    const user = userEvent.setup();
    render(<Harness initial="clauses" />);
    await user.click(tab('Clauses'));
    await user.keyboard('{End}');
    expect(tab('Compare')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Compare')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Overview')).toHaveFocus();
  });

  it('ignores other keys, so typing on a tab does not change the section', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await user.click(tab('Overview'));
    onSelect.mockClear();
    await user.keyboard('{ArrowDown}a');
    expect(onSelect).not.toHaveBeenCalled();
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  });

  it('skips disabled tabs when moving with the arrow keys', async () => {
    const user = userEvent.setup();
    const tabs: TabDefinition<Section>[] = TABS.map((item) =>
      item.id === 'ask' ? { ...item, disabled: true } : item,
    );
    render(<Harness tabs={tabs} initial="clauses" />);
    await user.click(tab('Clauses'));
    await user.keyboard('{ArrowRight}');
    expect(tab('Compare')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Compare')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tab('Clauses')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Ask')).toHaveAttribute('aria-selected', 'false');
  });

  it('lands Home and End on the nearest enabled tab when an end tab is disabled', async () => {
    const user = userEvent.setup();
    const tabs: TabDefinition<Section>[] = TABS.map((item) =>
      item.id === 'overview' || item.id === 'compare' ? { ...item, disabled: true } : item,
    );
    render(<Harness tabs={tabs} initial="clauses" />);
    await user.click(tab('Clauses'));
    await user.keyboard('{End}');
    expect(tab('Ask')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(tab('Clauses')).toHaveAttribute('aria-selected', 'true');
  });

  it('stays put when every other tab is disabled', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const tabs: TabDefinition<Section>[] = TABS.map((item) =>
      item.id === 'overview' ? item : { ...item, disabled: true },
    );
    render(<Harness tabs={tabs} onSelect={onSelect} />);
    await user.click(tab('Overview'));
    await user.keyboard('{ArrowRight}{ArrowLeft}');
    expect(onSelect.mock.calls.every(([id]) => id === 'overview')).toBe(true);
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  });

  it('does not select a disabled tab when it is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const tabs: TabDefinition<Section>[] = TABS.map((item) =>
      item.id === 'ask' ? { ...item, disabled: true } : item,
    );
    render(<Harness tabs={tabs} onSelect={onSelect} />);
    expect(tab('Ask')).toBeDisabled();
    await user.click(tab('Ask'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(tab('Overview')).toHaveAttribute('aria-selected', 'true');
  });

  it('ignores arrow keys when the selected id matches no tab', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <Tabs tabs={TABS} selected={'missing' as Section} onSelect={onSelect} label="Report sections">
        <p>Nothing selected</p>
      </Tabs>,
    );
    tab('Clauses').focus();
    await user.keyboard('{ArrowRight}{Home}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows a count beside the label, and nothing when the count is zero', () => {
    const tabs: TabDefinition<Section>[] = [
      { id: 'overview', label: 'Overview', badge: 3 },
      { id: 'clauses', label: 'Clauses', badge: 0 },
      { id: 'ask', label: 'Ask' },
    ];
    render(<Harness tabs={tabs} />);
    expect(screen.getByRole('tab', { name: /^Overview/ })).toHaveTextContent('Overview3');
    expect(tab('Clauses')).toHaveTextContent(/^Clauses$/);
    expect(tab('Ask')).toHaveTextContent(/^Ask$/);
  });

  it('has no axe violations', async () => {
    const tabs: TabDefinition<Section>[] = [
      { id: 'overview', label: 'Overview', badge: 2 },
      { id: 'clauses', label: 'Clauses' },
      { id: 'ask', label: 'Ask', disabled: true },
      { id: 'compare', label: 'Compare' },
    ];
    const { container } = render(<Harness tabs={tabs} />);
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
