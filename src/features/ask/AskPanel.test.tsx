import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { LIMITS } from '@shared/limits';
import type { AskResult } from '@shared/types';
import { AskPanel } from './AskPanel';
import { clause, renderWithProviders } from '@/test/factories';
import type { QaEntry } from '@/state/appState';

const CLAUSES = [clause()];

function answered(overrides: Partial<AskResult> = {}): AskResult {
  return {
    status: 'answered',
    answer: 'Your notice period is ninety days.',
    citations: [{ clauseId: 'c001', quote: 'ninety (90) days written notice', status: 'verified' }],
    missingInfo: [],
    suggestedQuestions: [],
    ...overrides,
  };
}

function entry(overrides: Partial<QaEntry> = {}): QaEntry {
  return {
    id: 'q1',
    question: 'What is my notice?',
    result: answered(),
    status: 'ready',
    ...overrides,
  };
}

function renderPanel(qa: QaEntry[] = [], onAsk = vi.fn(), onCitationFollowed = vi.fn()) {
  renderWithProviders(
    <AskPanel clauses={CLAUSES} onAsk={onAsk} onCitationFollowed={onCitationFollowed} />,
    { qa, lenses: ['QUIT_EARLY'] },
  );
  return { onAsk, onCitationFollowed };
}

describe('AskPanel', () => {
  it('sends a trimmed question and clears the box', async () => {
    const user = userEvent.setup();
    const { onAsk } = renderPanel();
    const box = screen.getByLabelText('Your question');

    await user.type(box, '   What is my notice period?   ');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(onAsk).toHaveBeenCalledWith('What is my notice period?');
    expect(box).toHaveValue('');
  });

  it('will not send a question that is too short to mean anything', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText('Your question'), 'hi');
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeDisabled();
  });

  it('explains the length limit and marks the field invalid when a question is too long', async () => {
    const user = userEvent.setup();
    renderPanel();
    const box = screen.getByLabelText('Your question');
    await user.click(box);
    await user.paste('x'.repeat(LIMITS.maxQuestionChars + 1));

    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(/under 500 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^ask$/i })).toBeDisabled();
  });

  it('offers questions suited to the chosen concerns, and asks one when clicked', async () => {
    const user = userEvent.setup();
    const { onAsk } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'What is my notice period?' }));
    expect(onAsk).toHaveBeenCalledWith('What is my notice period?');
  });

  it('says there are no questions yet', () => {
    renderPanel();
    expect(screen.getByText(/no questions yet/i)).toBeInTheDocument();
  });

  it('announces answers in a polite live region rather than moving focus', () => {
    renderPanel([entry()]);
    const answer = screen.getByText('Your notice period is ninety days.');
    expect(answer.closest('[aria-live="polite"]')).not.toBeNull();
  });

  it.each([
    ['answered', 'Answered from your document'],
    ['not_in_document', 'Your document does not say this'],
    ['needs_professional', 'Worth asking a lawyer'],
  ] as const)('labels a %s answer in words', (status, label) => {
    renderPanel([entry({ result: answered({ status }) })]);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('turns each citation into a button that goes to its clause, using the clause label', async () => {
    const user = userEvent.setup();
    const { onCitationFollowed } = renderPanel([entry()]);
    await user.click(screen.getByRole('button', { name: 'Go to clause 6.1' }));
    expect(onCitationFollowed).toHaveBeenCalledWith('c001');
    expect(screen.getByText('Verified quote')).toBeInTheDocument();
  });

  it('falls back to the clause id when the cited clause has no label', () => {
    renderPanel([
      entry({
        result: answered({ citations: [{ clauseId: 'c404', quote: 'x', status: 'fuzzy' }] }),
      }),
    ]);
    expect(screen.getByRole('button', { name: 'Go to clause c404' })).toBeInTheDocument();
  });

  it('shows what is missing and what to ask next when the document is silent', () => {
    renderPanel([
      entry({
        result: answered({
          status: 'not_in_document',
          citations: [],
          missingInfo: ['Health insurance is not covered.'],
          suggestedQuestions: ['Is there a separate benefits policy?'],
        }),
      }),
    ]);
    expect(screen.getByText('Health insurance is not covered.')).toBeInTheDocument();
    expect(screen.getByText('Is there a separate benefits policy?')).toBeInTheDocument();
    expect(screen.queryByText(/where this comes from/i)).not.toBeInTheDocument();
  });

  it('shows a waiting message while an answer is on its way', () => {
    renderPanel([entry({ status: 'loading', result: null })]);
    expect(screen.getByText(/looking through your document/i)).toBeInTheDocument();
  });

  it('shows a failure as an alert, defaulting to a generic message', () => {
    renderPanel([
      entry({ id: 'a', status: 'error', result: null, errorCode: 'RATE_LIMITED' }),
      entry({ id: 'b', status: 'error', result: null }),
    ]);
    const alerts = screen.getAllByRole('alert');
    expect(alerts[0]).toHaveTextContent(/wait a minute/i);
    expect(alerts[1]).toHaveTextContent(/something went wrong/i);
  });

  it('has no axe violations with an answer on screen', async () => {
    const { container } = (() => {
      const result = renderWithProviders(
        <AskPanel clauses={CLAUSES} onAsk={vi.fn()} onCitationFollowed={vi.fn()} />,
        { qa: [entry()] },
      );
      return result;
    })();
    await expect(axe(container)).resolves.toHaveNoViolations();
  });
});
