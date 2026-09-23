import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ClientModule from '@/api/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import type { AskResult, CompareResult, PrepareResult } from '@shared/types';
import { ReportScreen } from './ReportScreen';
import {
  analysis,
  byTextContent,
  clause,
  parsedDocument,
  renderWithProviders,
} from '@/test/factories';
import { useAppState, type AppState } from '@/state/appState';

/**
 * ReportScreen owns every network call, so the API client is replaced wholesale here. That keeps
 * these tests about what the screen does with results and failures - the client's own
 * behaviour is covered in src/api/client.test.ts.
 */
const api = vi.hoisted(() => ({
  analyzeDocument: vi.fn(),
  askQuestion: vi.fn(),
  compareDocuments: vi.fn(),
  preparePack: vi.fn(),
}));

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof ClientModule>();
  return { ...actual, ...api };
});

const { ApiError } = await import('@/api/client');

const SESSION = { token: 'token-1', expiresAt: 1_900_000_000 };

const LOADING: Partial<AppState> = {
  stage: 'report',
  document: parsedDocument([clause()]),
  session: SESSION,
  sessionStatus: 'ready',
  analysisStatus: 'loading',
};

const READY: Partial<AppState> = {
  ...LOADING,
  analysisStatus: 'ready',
  analysis: analysis(),
};

const ANSWER: AskResult = {
  status: 'answered',
  answer: 'Your notice period is ninety days.',
  citations: [
    {
      clauseId: 'c001',
      quote: 'ninety (90) days written notice',
      status: 'verified',
      start: 24,
      end: 55,
    },
  ],
  missingInfo: [],
  suggestedQuestions: [],
};

const SHEET: PrepareResult = {
  checklistBeforeSigning: ['Confirm the notice period in writing.'],
  questionsForHR: ['Can I buy out my notice?'],
  questionsForLawyer: ['Is the bond reasonable?'],
  missingInformation: [],
  documentsToBring: ['A copy of this offer letter.'],
};

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

/**
 * Shows the session the screen is working with, and stands in for the session gate: the
 * button hands over a fresh token, as a renewed security check would.
 */
function SessionProbe() {
  const { state, dispatch } = useAppState();
  return (
    <div>
      <output aria-label="session">
        {state.sessionStatus}|{state.session?.token ?? 'none'}
      </output>
      <button
        type="button"
        onClick={() => {
          dispatch({ type: 'sessionReady', session: { token: 'token-2', expiresAt: 2 } });
        }}
      >
        renew
      </button>
    </div>
  );
}

describe('ReportScreen: an expired session', () => {
  it('renews the session and runs the analysis again, without asking the reader to reload', async () => {
    const user = userEvent.setup();
    api.analyzeDocument
      .mockRejectedValueOnce(new ApiError('UNAUTHORIZED', false))
      .mockResolvedValueOnce(analysis());
    renderWithProviders(
      <>
        <ReportScreen />
        <SessionProbe />
      </>,
      LOADING,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('pending|none');
    });
    // Still loading, not failed: the reader sees progress, not an error.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'renew' }));
    expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(api.analyzeDocument).toHaveBeenCalledTimes(2);
    expect(api.analyzeDocument.mock.calls[1]?.[0]).toBe('token-2');
  });

  it('gives up after one renewal, so a server that keeps refusing cannot loop', async () => {
    const user = userEvent.setup();
    api.analyzeDocument.mockRejectedValue(new ApiError('UNAUTHORIZED', false));
    renderWithProviders(
      <>
        <ReportScreen />
        <SessionProbe />
      </>,
      LOADING,
    );

    await waitFor(() => {
      expect(screen.getByLabelText('session')).toHaveTextContent('pending|none');
    });
    await user.click(screen.getByRole('button', { name: 'renew' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/renewing it now/i);
    expect(api.analyzeDocument).toHaveBeenCalledTimes(2);
  });

  it('says so instead of doing nothing when preparing without a session', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, { ...READY, session: null, sessionStatus: 'pending' });
    await user.click(screen.getByRole('tab', { name: /prepare/i }));
    await user.click(screen.getByRole('button', { name: /build/i }));
    expect(await screen.findByText(/renewing it now/i)).toBeInTheDocument();
    expect(api.preparePack).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ReportScreen: analysis', () => {
  it('shows a busy state with a live progress message while analysing', () => {
    api.analyzeDocument.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<ReportScreen />, LOADING);

    expect(screen.getByRole('region', { name: /your report/i })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByText(/checking every quote/i)).toHaveAttribute('aria-live', 'polite');
  });

  it('sends the document, concerns and reading preferences, then shows the report', async () => {
    api.analyzeDocument.mockResolvedValue(analysis());
    renderWithProviders(<ReportScreen />, { ...LOADING, lenses: ['QUIT_EARLY'] });

    expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
    expect(api.analyzeDocument).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ lenses: ['QUIT_EARLY'], language: 'en', readingLevel: 'standard' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('waits for a session that is still pending instead of failing', () => {
    renderWithProviders(<ReportScreen />, { ...LOADING, session: null, sessionStatus: 'pending' });
    expect(api.analyzeDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports a session that never arrived rather than spinning forever', async () => {
    renderWithProviders(<ReportScreen />, { ...LOADING, session: null, sessionStatus: 'failed' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not start a session/i);
  });

  it('reports an empty document as an error rather than sending it', async () => {
    renderWithProviders(<ReportScreen />, { ...LOADING, document: parsedDocument([]) });
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(api.analyzeDocument).not.toHaveBeenCalled();
  });

  it('explains a failure in words and offers to try again', async () => {
    api.analyzeDocument.mockRejectedValueOnce(new ApiError('RATE_LIMITED', true));
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, LOADING);

    expect(await screen.findByRole('alert')).toHaveTextContent(/wait a minute/i);

    api.analyzeDocument.mockResolvedValueOnce(analysis());
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('tab', { name: /overview/i })).toBeInTheDocument();
  });

  it('treats an unexpected error as an internal one', async () => {
    api.analyzeDocument.mockRejectedValueOnce(new TypeError('boom'));
    renderWithProviders(<ReportScreen />, LOADING);
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });

  it('counts only verified high-risk findings on the Overview tab badge', () => {
    renderWithProviders(<ReportScreen />, READY);
    expect(screen.getByRole('tab', { name: /overview/i })).toHaveTextContent('1');
  });
});

describe('ReportScreen: tabs', () => {
  it('switches between every tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(screen.getByRole('tab', { name: /clauses/i }));
    expect(screen.getByRole('heading', { name: /every clause/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    expect(screen.getByRole('heading', { name: /ask about your document/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /compare/i }));
    expect(screen.getByRole('heading', { name: /compare two versions/i })).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: /prepare/i }));
    expect(screen.getByRole('button', { name: /build my preparation sheet/i })).toBeInTheDocument();
  });

  it('clears everything when asked', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<ReportScreen />, READY);
    await user.click(screen.getByRole('button', { name: /clear everything/i }));
    // With the document gone the screen falls back to its error state rather than a stale report.
    expect(container).not.toHaveTextContent('Nimbus Technologies');
  });
});

describe('ReportScreen: asking', () => {
  it('asks with the document and shows the answer', async () => {
    api.askQuestion.mockResolvedValue(ANSWER);
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    await user.type(screen.getByLabelText(/your question/i), 'What is my notice period?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(
      await screen.findByText(byTextContent('Your notice period is ninety days.')),
    ).toBeInTheDocument();
    expect(api.askQuestion).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ question: 'What is my notice period?', history: [] }),
    );
  });

  it('sends the last answered turns as history for a follow-up', async () => {
    api.askQuestion.mockResolvedValue(ANSWER);
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    await user.type(screen.getByLabelText(/your question/i), 'First question here');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    await screen.findByText(byTextContent('Your notice period is ninety days.'));

    await user.type(screen.getByLabelText(/your question/i), 'And a follow-up');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    await waitFor(() => {
      expect(api.askQuestion).toHaveBeenLastCalledWith(
        'token-1',
        expect.objectContaining({
          history: [{ question: 'First question here', answer: ANSWER.answer }],
        }),
      );
    });
  });

  it('shows a failed answer against its own question', async () => {
    api.askQuestion.mockRejectedValue(new ApiError('UPSTREAM_TIMEOUT', true));
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    await user.type(screen.getByLabelText(/your question/i), 'Will this time out?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/took too long/i);
  });

  it('treats a non-API failure while asking as an internal error', async () => {
    api.askQuestion.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    await user.type(screen.getByLabelText(/your question/i), 'Anything at all?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });

  it('follows a citation to the Clauses tab', async () => {
    api.askQuestion.mockResolvedValue(ANSWER);
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    await user.type(screen.getByLabelText(/your question/i), 'What is my notice period?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    await user.click(await screen.findByRole('button', { name: /go to clause 6\.1/i }));

    expect(screen.getByRole('tab', { name: /clauses/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: /hide the original text/i })).toBeInTheDocument();
    // The point of a citation button: focus lands on the clause, so a keyboard or screen-reader
    // user is taken to the evidence rather than left on the button they pressed.
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('clause-c001');
    });
  });

  it('says the check is being renewed, rather than ignoring the click, while there is no session', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, { ...READY, session: null, sessionStatus: 'pending' });
    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    await user.type(screen.getByLabelText(/your question/i), 'Is anyone there?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(api.askQuestion).not.toHaveBeenCalled();
    expect(await screen.findByText(/renewing it now/i)).toBeInTheDocument();
  });

  it('renews the session when an answer is refused, and asks the reader to try again', async () => {
    const user = userEvent.setup();
    api.askQuestion.mockRejectedValue(new ApiError('UNAUTHORIZED', false));
    renderWithProviders(
      <>
        <ReportScreen />
        <SessionProbe />
      </>,
      READY,
    );
    await user.click(screen.getByRole('tab', { name: /^ask$/i }));
    await user.type(screen.getByLabelText(/your question/i), 'What is my notice period?');
    await user.click(screen.getByRole('button', { name: /^ask$/i }));
    expect(await screen.findByText(/renewing it now/i)).toBeInTheDocument();
    expect(screen.getByLabelText('session')).toHaveTextContent('pending|none');
  });
});

describe('ReportScreen: preparing', () => {
  it('builds the sheet, passing unanswered questions along', async () => {
    api.preparePack.mockResolvedValue(SHEET);
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, {
      ...READY,
      qa: [
        {
          id: 'q1',
          question: 'Parents insurance?',
          status: 'ready',
          result: { ...ANSWER, status: 'not_in_document', citations: [] },
        },
      ],
    });

    await user.click(screen.getByRole('tab', { name: /prepare/i }));
    await user.click(screen.getByRole('button', { name: /build my preparation sheet/i }));

    expect(await screen.findByText('Is the bond reasonable?')).toBeInTheDocument();
    expect(api.preparePack).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ unansweredQuestions: ['Parents insurance?'] }),
    );
  });

  it('shows why building the sheet failed', async () => {
    api.preparePack.mockRejectedValue(new ApiError('MODEL_BLOCKED', false));
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(screen.getByRole('tab', { name: /prepare/i }));
    await user.click(screen.getByRole('button', { name: /build my preparation sheet/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not process this document/i);
  });

  it('treats a non-API failure while preparing as an internal error', async () => {
    api.preparePack.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);
    await user.click(screen.getByRole('tab', { name: /prepare/i }));
    await user.click(screen.getByRole('button', { name: /build my preparation sheet/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/something went wrong/i);
  });
});

describe('ReportScreen: comparing', () => {
  const REVISED = 'The Employee shall give sixty (60) days written notice of resignation.';
  const RESULT: CompareResult = { changes: [], unchangedCount: 4 };

  async function addRevision(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('tab', { name: /compare/i }));
    const input = screen.getByLabelText(/choose a file/i, { selector: 'input' });
    await user.upload(input, new File([`1. ${REVISED}`], 'revised.txt', { type: 'text/plain' }));
    return screen.findByRole('button', { name: /compare the two versions/i });
  }

  it('compares the original with the revised document', async () => {
    api.compareDocuments.mockResolvedValue(RESULT);
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);

    await user.click(await addRevision(user));
    expect(await screen.findByText(/nothing meaningful changed/i)).toBeInTheDocument();
    expect(api.compareDocuments).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ clausesA: expect.any(Array), clausesB: expect.any(Array) }),
    );
  });

  it('shows why the comparison failed', async () => {
    api.compareDocuments.mockRejectedValue(new ApiError('INTERNAL', true));
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);
    await user.click(await addRevision(user));
    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong on our side/i);
  });

  it('treats a non-API failure while comparing as an internal error', async () => {
    api.compareDocuments.mockRejectedValue(new Error('x'));
    const user = userEvent.setup();
    renderWithProviders(<ReportScreen />, READY);
    await user.click(await addRevision(user));
    expect(await screen.findByRole('alert')).toHaveTextContent(/went wrong on our side/i);
  });
});

it('has no axe violations on a finished report', async () => {
  const { container } = renderWithProviders(<ReportScreen />, READY);
  await expect(axe(container)).resolves.toHaveNoViolations();
});
