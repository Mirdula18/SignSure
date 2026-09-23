import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { appReducer, initialState, useAppState, AppStateProvider, type AppState } from './appState';
import { analysis, clause, parsedDocument } from '@/test/factories';

const SESSION = { token: 'token-abc', expiresAt: 1_900_000_000 };

function reduce(state: AppState, ...actions: Parameters<typeof appReducer>[1][]): AppState {
  return actions.reduce(appReducer, state);
}

describe('appReducer', () => {
  describe('the session', () => {
    it('starts pending, so a request made before the session lands waits instead of failing', () => {
      expect(initialState.sessionStatus).toBe('pending');
      expect(initialState.session).toBeNull();
    });

    it('records a session and marks it ready', () => {
      const state = reduce(initialState, { type: 'sessionReady', session: SESSION });
      expect(state.session).toEqual(SESSION);
      expect(state.sessionStatus).toBe('ready');
    });

    it('records a failed security check', () => {
      expect(reduce(initialState, { type: 'sessionFailed' }).sessionStatus).toBe('failed');
    });

    it('drops a refused session so the check runs again, keeping the document and report', () => {
      const withReport = reduce(reduce(initialState, { type: 'sessionReady', session: SESSION }), {
        type: 'documentParsed',
        document: parsedDocument(),
      });
      const expired = reduce(withReport, { type: 'sessionExpired' });
      expect(expired.session).toBeNull();
      expect(expired.sessionStatus).toBe('pending');
      expect(expired.document).toBe(withReport.document);
    });
  });

  describe('a new document', () => {
    it('moves to the concern picker', () => {
      const state = reduce(initialState, { type: 'documentParsed', document: parsedDocument() });
      expect(state.stage).toBe('lenses');
      expect(state.document?.clauses).toHaveLength(1);
    });

    it('discards every result derived from the previous document', () => {
      const before = reduce(
        initialState,
        { type: 'sessionReady', session: SESSION },
        { type: 'documentParsed', document: parsedDocument() },
        { type: 'analysisReady', analysis: analysis() },
        { type: 'questionAsked', id: 'q1', question: 'What is my notice?' },
        { type: 'clauseFocused', clauseId: 'c001' },
      );

      const after = reduce(before, {
        type: 'documentParsed',
        document: parsedDocument([clause({ id: 'c001', text: 'A different document entirely.' })]),
      });

      expect(after.analysis).toBeNull();
      expect(after.qa).toEqual([]);
      expect(after.focusedClauseId).toBeNull();
      expect(after.document?.clauses[0]?.text).toBe('A different document entirely.');
    });

    it('keeps the session and the chosen concerns, which have nothing to do with the document', () => {
      const state = reduce(
        initialState,
        { type: 'sessionReady', session: SESSION },
        { type: 'lensesChosen', lenses: ['QUIT_EARLY'] },
        { type: 'documentParsed', document: parsedDocument() },
      );
      expect(state.session).toEqual(SESSION);
      expect(state.sessionStatus).toBe('ready');
      expect(state.lenses).toEqual(['QUIT_EARLY']);
    });
  });

  describe('analysis', () => {
    it('moves to the report and shows it as loading', () => {
      const state = reduce(initialState, { type: 'analysisStarted' });
      expect(state.stage).toBe('report');
      expect(state.analysisStatus).toBe('loading');
    });

    it('stores a finished analysis', () => {
      const result = analysis();
      const state = reduce(
        initialState,
        { type: 'analysisStarted' },
        { type: 'analysisReady', analysis: result },
      );
      expect(state.analysisStatus).toBe('ready');
      expect(state.analysis).toBe(result);
    });

    it('records why an analysis failed', () => {
      const state = reduce(initialState, { type: 'analysisFailed', code: 'RATE_LIMITED' });
      expect(state.analysisStatus).toBe('error');
      expect(state.analysisError).toBe('RATE_LIMITED');
    });

    it('clears a previous result when a retry starts', () => {
      const state = reduce(
        initialState,
        { type: 'analysisReady', analysis: analysis() },
        { type: 'analysisStarted' },
      );
      expect(state.analysis).toBeNull();
    });
  });

  describe('questions', () => {
    it('adds a question as loading, then fills in its answer by id', () => {
      const asked = reduce(
        initialState,
        { type: 'questionAsked', id: 'q1', question: 'First?' },
        { type: 'questionAsked', id: 'q2', question: 'Second?' },
      );
      expect(asked.qa.map((entry) => entry.status)).toEqual(['loading', 'loading']);

      const answered = reduce(asked, {
        type: 'answerReady',
        id: 'q2',
        result: {
          status: 'not_in_document',
          answer: 'Your document does not say this.',
          citations: [],
          missingInfo: [],
          suggestedQuestions: [],
        },
      });
      expect(answered.qa[0]?.status).toBe('loading');
      expect(answered.qa[1]?.status).toBe('ready');
      expect(answered.qa[1]?.result?.status).toBe('not_in_document');
    });

    it('records a failed answer against the right question only', () => {
      const state = reduce(
        initialState,
        { type: 'questionAsked', id: 'q1', question: 'First?' },
        { type: 'questionAsked', id: 'q2', question: 'Second?' },
        { type: 'answerFailed', id: 'q1', code: 'UPSTREAM_TIMEOUT' },
      );
      expect(state.qa[0]).toMatchObject({ status: 'error', errorCode: 'UPSTREAM_TIMEOUT' });
      expect(state.qa[1]?.status).toBe('loading');
    });
  });

  describe('compare and prepare', () => {
    it('resets any earlier comparison when a new second document arrives', () => {
      const state = reduce(
        initialState,
        { type: 'compareReady', compare: { changes: [], unchangedCount: 3 } },
        { type: 'compareDocumentParsed', document: parsedDocument() },
      );
      expect(state.compare).toBeNull();
      expect(state.compareStatus).toBe('idle');
      expect(state.compareDocument).not.toBeNull();
    });

    it('walks a comparison through loading, ready and error', () => {
      const loading = reduce(initialState, { type: 'compareStarted' });
      expect(loading.compareStatus).toBe('loading');
      const ready = reduce(loading, {
        type: 'compareReady',
        compare: { changes: [], unchangedCount: 1 },
      });
      expect(ready.compareStatus).toBe('ready');
      const failed = reduce(loading, { type: 'compareFailed', code: 'INTERNAL' });
      expect(failed).toMatchObject({ compareStatus: 'error', compareError: 'INTERNAL' });
    });

    it('walks a preparation sheet through loading, ready and error', () => {
      const sheet = {
        checklistBeforeSigning: ['Read it'],
        questionsForHR: [],
        questionsForLawyer: [],
        missingInformation: [],
        documentsToBring: [],
      };
      const loading = reduce(initialState, { type: 'prepareStarted' });
      expect(loading.prepareStatus).toBe('loading');
      expect(reduce(loading, { type: 'prepareReady', prepare: sheet }).prepare).toBe(sheet);
      expect(reduce(loading, { type: 'prepareFailed', code: 'MODEL_BLOCKED' })).toMatchObject({
        prepareStatus: 'error',
        prepareError: 'MODEL_BLOCKED',
      });
    });
  });

  it('focuses and unfocuses a clause', () => {
    const focused = reduce(initialState, { type: 'clauseFocused', clauseId: 'c004' });
    expect(focused.focusedClauseId).toBe('c004');
    expect(reduce(focused, { type: 'clauseFocused', clauseId: null }).focusedClauseId).toBeNull();
  });

  describe('clearing everything', () => {
    it('removes the document and every result, returning to the start', () => {
      const full = reduce(
        initialState,
        { type: 'sessionReady', session: SESSION },
        { type: 'documentParsed', document: parsedDocument() },
        { type: 'analysisReady', analysis: analysis() },
        { type: 'questionAsked', id: 'q1', question: 'Anything?' },
      );
      const cleared = reduce(full, { type: 'clearEverything' });

      expect(cleared.stage).toBe('upload');
      expect(cleared.document).toBeNull();
      expect(cleared.analysis).toBeNull();
      expect(cleared.qa).toEqual([]);
    });

    it('keeps the session, so clearing a document does not mean solving the check again', () => {
      const cleared = reduce(
        initialState,
        { type: 'sessionReady', session: SESSION },
        { type: 'clearEverything' },
      );
      expect(cleared.session).toEqual(SESSION);
      expect(cleared.sessionStatus).toBe('ready');
    });
  });
});

describe('AppStateProvider', () => {
  function Probe() {
    const { state, clauseById } = useAppState();
    return (
      <p>
        {state.stage}:{clauseById('c002')?.label ?? 'none'}
      </p>
    );
  }

  it('looks clauses up by id from the current document', () => {
    render(
      <AppStateProvider
        initial={{
          ...initialState,
          document: parsedDocument([clause(), clause({ id: 'c002', label: '9.2', order: 1 })]),
        }}
      >
        <Probe />
      </AppStateProvider>,
    );
    expect(screen.getByText('upload:9.2')).toBeInTheDocument();
  });

  it('returns nothing for an unknown id or when there is no document', () => {
    render(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>,
    );
    expect(screen.getByText('upload:none')).toBeInTheDocument();
  });

  it('throws a helpful error when used outside the provider', () => {
    const original = console.error;
    console.error = () => undefined;
    try {
      expect(() => render(<Probe />)).toThrow(/must be used inside/);
    } finally {
      console.error = original;
    }
  });
});
