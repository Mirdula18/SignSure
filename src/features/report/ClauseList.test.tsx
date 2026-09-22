import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ClauseList } from './ClauseList';
import { analysis, clause, finding, renderWithPreferences } from '@/test/factories';

const NBSP = String.fromCodePoint(0x00a0);

const CLAUSES = [
  clause(),
  clause({
    id: 'c002',
    label: '5.2',
    text: `The Employee shall pay Rs.${NBSP}2,00,000 as liquidated damages.`,
    order: 1,
  }),
  clause({ id: 'c003', label: '8.1', text: 'All information is confidential.', order: 2 }),
];

const ANALYSIS = analysis({
  findings: [
    finding({ title: 'Notice finding' }),
    finding({
      clauseId: 'c002',
      category: 'BOND_OR_EXIT_PENALTY',
      risk: 'HIGH',
      title: 'Bond finding',
    }),
    finding({
      clauseId: 'c003',
      category: 'CONFIDENTIALITY',
      risk: 'INFO',
      title: 'Secret finding',
    }),
  ],
});

function renderList(focusedClauseId: string | null = null) {
  return renderWithPreferences(
    <ClauseList analysis={ANALYSIS} clauses={CLAUSES} focusedClauseId={focusedClauseId} />,
  );
}

describe('ClauseList', () => {
  it('shows every finding and says how many', () => {
    renderList();
    expect(screen.getByText('Showing 3 of 3 clauses.')).toBeInTheDocument();
  });

  it('offers only the categories that actually appear, in plain words', () => {
    renderList();
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options).toContain('Bond or exit penalty');
    expect(options).not.toContain('Non-compete');
  });

  it('filters by category', async () => {
    const user = userEvent.setup();
    renderList();
    await user.selectOptions(screen.getByLabelText('Category'), 'CONFIDENTIALITY');
    expect(screen.getByText('Secret finding')).toBeInTheDocument();
    expect(screen.queryByText('Bond finding')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 3 clauses.')).toBeInTheDocument();
  });

  it('filters by risk level', async () => {
    const user = userEvent.setup();
    renderList();
    await user.selectOptions(screen.getByLabelText('Risk level'), 'INFO');
    expect(screen.getByText('Secret finding')).toBeInTheDocument();
    expect(screen.queryByText('Notice finding')).not.toBeInTheDocument();
  });

  it('searches the original text with the same normalisation used for verification', async () => {
    // The document uses a non-breaking space; the reader types an ordinary one.
    const user = userEvent.setup();
    renderList();
    await user.type(screen.getByLabelText('Search the clauses'), 'rs. 2,00,000');
    expect(screen.getByText('Bond finding')).toBeInTheDocument();
    expect(screen.queryByText('Notice finding')).not.toBeInTheDocument();
  });

  it('announces the count in a live region and says so when nothing matches', async () => {
    const user = userEvent.setup();
    renderList();
    await user.type(screen.getByLabelText('Search the clauses'), 'no such words anywhere');
    expect(screen.getByText('No clauses match these filters.')).toBeInTheDocument();
    expect(screen.getByText('Showing 0 of 3 clauses.')).toHaveAttribute('aria-live', 'polite');
  });

  it('opens the clause a citation pointed at', () => {
    renderList('c002');
    expect(screen.getAllByRole('button', { name: /hide the original text/i })).toHaveLength(1);
  });

  it('has no axe violations', async () => {
    const { container } = renderList();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
