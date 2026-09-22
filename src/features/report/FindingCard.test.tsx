import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FindingCard } from './FindingCard';
import { RuleCard } from './RuleCard';
import { ClauseTitle, SideBySide } from './SideBySide';
import { clause, finding, renderWithPreferences, ruleHit } from '@/test/factories';

describe('FindingCard', () => {
  it('shows risk, category and verification as words, never colour alone', () => {
    renderWithPreferences(<FindingCard finding={finding()} clause={clause()} />);
    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getByText('Notice period')).toBeInTheDocument();
    expect(screen.getAllByText('Verified quote')[0]).toBeVisible();
  });

  it('names the clause and its page, so the reader can find it in their own copy', () => {
    renderWithPreferences(<FindingCard finding={finding()} clause={clause()} />);
    expect(screen.getAllByText(/Clause 6\.1/)[0]).toBeVisible();
    expect(screen.getAllByText(/Page 2/).length).toBeGreaterThan(0);
  });

  it('keeps the original text closed until asked, then shows it with the quote marked', async () => {
    const user = userEvent.setup();
    const { container } = renderWithPreferences(
      <FindingCard finding={finding()} clause={clause()} />,
    );

    const toggle = screen.getByRole('button', { name: /view the original text/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('mark')).not.toBeVisible();

    await user.click(toggle);
    expect(screen.getByRole('button', { name: /hide the original text/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeVisible();
    expect(mark).toHaveTextContent('ninety (90) days written notice');
  });

  it('opens straight away when a citation sent the reader here', () => {
    renderWithPreferences(<FindingCard finding={finding()} clause={clause()} defaultOpen />);
    expect(screen.getByRole('button', { name: /hide the original text/i })).toBeInTheDocument();
  });

  it('lists the questions to ask, and omits the list when there are none', () => {
    const { rerender } = renderWithPreferences(
      <FindingCard finding={finding()} clause={clause()} />,
    );
    expect(screen.getByText('Can I buy out my notice period?')).toBeInTheDocument();

    rerender(<FindingCard finding={finding({ questionsToAsk: [] })} clause={clause()} />);
    expect(screen.queryByText(/questions you could ask/i)).not.toBeInTheDocument();
  });

  it('gives the card an id the citation buttons can jump to', () => {
    const { container } = renderWithPreferences(
      <FindingCard finding={finding()} clause={clause()} />,
    );
    expect(container.querySelector('#clause-c001')).not.toBeNull();
  });

  it('has no axe violations when open', async () => {
    const { container } = renderWithPreferences(
      <FindingCard finding={finding()} clause={clause()} defaultOpen />,
    );
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});

describe('ClauseTitle and locations', () => {
  it('uses a page range for a clause that crosses a page break', () => {
    renderWithPreferences(<ClauseTitle clause={clause({ page: 3, pageEnd: 4 })} />);
    expect(screen.getByText(/Pages 3 to 4/)).toBeInTheDocument();
  });

  it('falls back to a paragraph number for formats with no pages', () => {
    renderWithPreferences(
      <ClauseTitle clause={clause({ label: null, page: null, pageEnd: null, order: 4 })} />,
    );
    expect(screen.getAllByText(/Paragraph 5/).length).toBeGreaterThan(0);
  });

  it('shows the heading when the clause has one', () => {
    renderWithPreferences(<ClauseTitle clause={clause({ heading: 'Notice Period' })} />);
    expect(screen.getByText(/Notice Period/)).toBeInTheDocument();
  });
});

describe('SideBySide', () => {
  it('labels the original-text region with the clause and page for screen readers', () => {
    renderWithPreferences(
      <SideBySide clause={clause()} evidence={finding().evidence}>
        <p>Explanation goes here</p>
      </SideBySide>,
    );
    expect(
      screen.getByRole('region', { name: /original text, clause 6\.1, page 2/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /explanation/i })).toHaveTextContent(
      'Explanation goes here',
    );
  });

  it('shows the whole clause unmarked when the quote could not be verified', () => {
    const { container } = renderWithPreferences(
      <SideBySide
        clause={clause()}
        evidence={{ clauseId: 'c001', quote: 'not present', status: 'unverified' }}
      >
        <p>x</p>
      </SideBySide>,
    );
    expect(container.querySelector('mark')).toBeNull();
    expect(screen.getByText('Could not verify')).toBeInTheDocument();
    expect(within(container).getByText(/written notice of resignation/)).toBeInTheDocument();
  });
});

describe('RuleCard', () => {
  it('shows the reviewed message, its legal basis and when it was last checked', () => {
    renderWithPreferences(<RuleCard hit={ruleHit()} />);
    expect(screen.getByRole('heading', { name: 'Long notice period' })).toBeInTheDocument();
    expect(screen.getByText(/Contract terms\./)).toBeInTheDocument();
    expect(screen.getByText(/Last reviewed 2026-09-20/)).toBeInTheDocument();
    expect(screen.getByText(/not advice about your situation/i)).toBeInTheDocument();
  });

  it('shows the values the rule pulled out of the clause', () => {
    renderWithPreferences(<RuleCard hit={ruleHit()} />);
    expect(screen.getByText('ninety (90) days')).toBeInTheDocument();
  });

  it('omits the details and questions blocks when a rule has neither', () => {
    const hit = ruleHit({ questions: [] });
    delete hit.details;
    renderWithPreferences(<RuleCard hit={hit} />);
    expect(screen.queryByText(/questions to ask/i)).not.toBeInTheDocument();
    expect(screen.queryByText('ninety (90) days')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = renderWithPreferences(<RuleCard hit={ruleHit()} />);
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
