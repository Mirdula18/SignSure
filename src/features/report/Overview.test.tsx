import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { axe } from 'vitest-axe';
import type { Clause } from '@shared/types';
import { Overview } from './Overview';
import { analysis, clause, finding, renderWithPreferences, ruleHit } from '@/test/factories';

const CLAUSES: Clause[] = [
  clause(),
  clause({
    id: 'c002',
    label: '9.2',
    text: 'For twenty-four months after leaving, the Employee shall not compete.',
    order: 1,
  }),
];

function byId(id: string): Clause | undefined {
  return CLAUSES.find((item) => item.id === id);
}

describe('Overview', () => {
  it('shows every summary field, saying "Not stated" rather than guessing', () => {
    renderWithPreferences(<Overview analysis={analysis()} clauseById={byId} />);

    expect(screen.getByText('Nimbus Technologies Private Limited')).toBeInTheDocument();
    // Role and probation are null in the fixture.
    expect(screen.getAllByText('Not stated').length).toBeGreaterThanOrEqual(2);
  });

  it('reports how many explanations are backed by a checked quote', () => {
    renderWithPreferences(<Overview analysis={analysis()} clauseById={byId} />);
    expect(screen.getByText(/1 of 1 explanations are backed by a quote/i)).toBeInTheDocument();
  });

  it('adds the unverified count only when there is something unverified', () => {
    const { rerender } = renderWithPreferences(
      <Overview analysis={analysis()} clauseById={byId} />,
    );
    expect(screen.queryByText(/could not be checked/i)).not.toBeInTheDocument();

    rerender(
      <Overview
        analysis={analysis({ stats: { verified: 1, fuzzy: 0, unverified: 2 } })}
        clauseById={byId}
      />,
    );
    expect(screen.getByText(/2 could not be checked/i)).toBeInTheDocument();
  });

  it('lists high and medium findings as things worth a close look', () => {
    renderWithPreferences(
      <Overview
        analysis={analysis({
          findings: [
            finding({ title: 'A high one' }),
            finding({ clauseId: 'c002', risk: 'MEDIUM', title: 'A medium one' }),
            finding({ clauseId: 'c002', risk: 'LOW', title: 'A low one' }),
          ],
        })}
        clauseById={byId}
      />,
    );
    const section = screen.getByRole('region', { name: /worth a close look/i });
    expect(within(section).getByText('A high one')).toBeInTheDocument();
    expect(within(section).getByText('A medium one')).toBeInTheDocument();
    expect(within(section).queryByText('A low one')).not.toBeInTheDocument();
  });

  it('says plainly when nothing high-risk was found, without implying the document is fine', () => {
    renderWithPreferences(
      <Overview analysis={analysis({ findings: [finding({ risk: 'LOW' })] })} clauseById={byId} />,
    );
    expect(screen.getByText(/did not find a high-risk clause/i)).toBeInTheDocument();
    expect(screen.getByText(/please still read it in full/i)).toBeInTheDocument();
  });

  it('keeps unverified findings out of the red flags and under their own heading', () => {
    renderWithPreferences(
      <Overview
        analysis={analysis({
          findings: [
            finding({
              title: 'An unchecked claim',
              evidence: { clauseId: 'c001', quote: 'not in the document', status: 'unverified' },
            }),
          ],
        })}
        clauseById={byId}
      />,
    );

    const flags = screen.getByRole('region', { name: /worth a close look/i });
    expect(within(flags).queryByText('An unchecked claim')).not.toBeInTheDocument();

    const unverified = screen.getByRole('region', { name: /we could not check these/i });
    expect(within(unverified).getByText('An unchecked claim')).toBeInTheDocument();
  });

  it('shows the rule cards and the missing information', () => {
    renderWithPreferences(<Overview analysis={analysis()} clauseById={byId} />);
    expect(screen.getByRole('region', { name: /legal context for india/i })).toBeInTheDocument();
    expect(screen.getByText('Long notice period')).toBeInTheDocument();
    expect(screen.getByText('Leave entitlement')).toBeInTheDocument();
  });

  it('says which clauses the AI summary came from, so each value can be checked', () => {
    const base = analysis();
    renderWithPreferences(
      <Overview
        analysis={{
          ...base,
          documentSummary: { ...base.documentSummary, sourceClauseIds: ['c002', 'c404'] },
        }}
        clauseById={byId}
      />,
    );
    // c404 is not in the document, so it is left out rather than shown as a broken reference.
    expect(
      screen.getByText(
        'Summarised by the AI from Clause 9.2. Check each value against those clauses before relying on it.',
      ),
    ).toBeInTheDocument();
  });

  it('still marks the summary as the AI reading when it names no source clause', () => {
    const base = analysis();
    renderWithPreferences(
      <Overview
        analysis={{ ...base, documentSummary: { ...base.documentSummary, sourceClauseIds: [] } }}
        clauseById={byId}
      />,
    );
    expect(screen.getByText(/^Summarised by the AI\. Check each value/)).toBeInTheDocument();
  });

  it('shows the missing information in Hindi to a Hindi reader', () => {
    sessionStorage.setItem('signsure.prefs', JSON.stringify({ language: 'hi' }));
    try {
      renderWithPreferences(<Overview analysis={analysis()} clauseById={byId} />);
      expect(screen.getByText('छुट्टियों का हक़')).toBeInTheDocument();
      expect(screen.getByText('मुझे साल में कितनी पेड छुट्टियाँ मिलेंगी?')).toBeInTheDocument();
      expect(screen.queryByText('Leave entitlement')).not.toBeInTheDocument();
    } finally {
      sessionStorage.clear();
    }
  });

  it('omits the rule and missing-information sections when there is nothing to show', () => {
    renderWithPreferences(
      <Overview analysis={analysis({ ruleHits: [], missingInfo: [] })} clauseById={byId} />,
    );
    expect(screen.queryByRole('region', { name: /legal context/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /does not say/i })).not.toBeInTheDocument();
  });

  it('skips a finding whose clause cannot be found rather than crashing', () => {
    renderWithPreferences(
      <Overview
        analysis={analysis({
          findings: [
            finding({ clauseId: 'c404', title: 'Orphan' }),
            finding({
              clauseId: 'c404',
              title: 'Orphan unverified',
              evidence: { clauseId: 'c404', quote: 'x', status: 'unverified' },
            }),
          ],
          ruleHits: [ruleHit()],
        })}
        clauseById={byId}
      />,
    );
    expect(screen.queryByText('Orphan')).not.toBeInTheDocument();
    expect(screen.queryByText('Orphan unverified')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithPreferences(
      <Overview analysis={analysis()} clauseById={byId} />,
    );
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
