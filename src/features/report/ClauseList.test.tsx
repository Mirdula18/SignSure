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
  it('shows every clause and says how many', () => {
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

  describe('with clauses that have no findings', () => {
    const PLAIN = clause({
      id: 'c004',
      label: '9.1',
      text: 'The Company will reimburse travel on production of receipts.',
      order: 3,
    });
    const WITH_TWO = analysis({
      findings: [
        ...ANALYSIS.findings,
        finding({ clauseId: 'c002', category: 'BOND_OR_EXIT_PENALTY', title: 'Second bond note' }),
      ],
    });

    function renderAll(focused: string | null = null) {
      return renderWithPreferences(
        <ClauseList analysis={WITH_TWO} clauses={[...CLAUSES, PLAIN]} focusedClauseId={focused} />,
      );
    }

    it('lists every clause, showing its own text when SignSure has nothing to add', () => {
      renderAll();
      expect(screen.getByText('Showing 4 of 4 clauses.')).toBeInTheDocument();
      expect(screen.getByText(/reimburse travel on production of receipts/)).toBeInTheDocument();
      expect(screen.getByText('SignSure has no notes on this clause.')).toBeInTheDocument();
    });

    it('gives each clause exactly one focusable citation target, however many findings it has', () => {
      const { container } = renderAll();
      const targets = [...container.querySelectorAll('[id^="clause-"]')].map((node) => node.id);
      expect(targets).toEqual(['clause-c001', 'clause-c002', 'clause-c003', 'clause-c004']);
      expect(container.querySelector('#clause-c004')).toHaveAttribute('tabindex', '-1');
      const bond = container.querySelector('#clause-c002');
      expect(bond?.querySelectorAll('article')).toHaveLength(2);
    });

    it('hides clauses without findings once a category or risk filter is chosen', async () => {
      const user = userEvent.setup();
      renderAll();
      await user.selectOptions(screen.getByLabelText('Risk level'), 'INFO');
      expect(screen.queryByText(/reimburse travel/)).not.toBeInTheDocument();
      expect(screen.getByText('Showing 1 of 4 clauses.')).toBeInTheDocument();
    });

    it('finds a clause without findings by searching its text', async () => {
      const user = userEvent.setup();
      renderAll();
      await user.type(screen.getByLabelText('Search the clauses'), 'receipts');
      expect(screen.getByText('Showing 1 of 4 clauses.')).toBeInTheDocument();
      expect(screen.getByText(/reimburse travel/)).toBeInTheDocument();
    });

    it('has no axe violations', async () => {
      const { container } = renderAll();
      await expect(axe(container)).resolves.toHaveNoViolations();
    });
  });

  it('has no axe violations', async () => {
    const { container } = renderList();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
