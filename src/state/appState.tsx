import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { Lens } from '@shared/lenses';
import type {
  AnalysisResult,
  ApiErrorCode,
  AskResult,
  CompareResult,
  ParsedDocument,
  PrepareResult,
} from '@shared/types';

/**
 * Everything the app knows about the current document.
 *
 * Deliberately in memory only. Nothing here is written to storage, so closing the tab really
 * does discard the contract - which is the promise made on the home page. Context plus a
 * reducer rather than a state library, because the state is small and the transitions are few.
 */

export type Stage = 'upload' | 'lenses' | 'report';

export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface QaEntry {
  id: string;
  question: string;
  result: AskResult | null;
  status: AsyncStatus;
  errorCode?: ApiErrorCode;
}

export interface AppState {
  stage: Stage;
  document: ParsedDocument | null;
  lenses: Lens[];
  session: { token: string; expiresAt: number } | null;
  /**
   * Whether a session is still being obtained.
   *
   * Needed because the reader can reach "Analyse" before the session has arrived: without this
   * the report cannot tell "no token yet" from "no token ever", and would either spin forever
   * or fail on a race it should simply have waited out.
   */
  sessionStatus: 'pending' | 'ready' | 'failed';

  analysis: AnalysisResult | null;
  analysisStatus: AsyncStatus;
  analysisError?: ApiErrorCode;

  qa: QaEntry[];

  compareDocument: ParsedDocument | null;
  compare: CompareResult | null;
  compareStatus: AsyncStatus;
  compareError?: ApiErrorCode;

  prepare: PrepareResult | null;
  prepareStatus: AsyncStatus;
  prepareError?: ApiErrorCode;

  /** Clause the user asked to inspect, e.g. by following a citation. */
  focusedClauseId: string | null;
}

export const initialState: AppState = {
  stage: 'upload',
  document: null,
  lenses: [],
  session: null,
  sessionStatus: 'pending',
  analysis: null,
  analysisStatus: 'idle',
  qa: [],
  compareDocument: null,
  compare: null,
  compareStatus: 'idle',
  prepare: null,
  prepareStatus: 'idle',
  focusedClauseId: null,
};

export type AppAction =
  | { type: 'sessionReady'; session: { token: string; expiresAt: number } }
  | { type: 'sessionFailed' }
  | { type: 'sessionExpired' }
  | { type: 'documentParsed'; document: ParsedDocument }
  | { type: 'lensesChosen'; lenses: Lens[] }
  | { type: 'analysisStarted' }
  | { type: 'analysisReady'; analysis: AnalysisResult }
  | { type: 'analysisFailed'; code: ApiErrorCode }
  | { type: 'questionAsked'; id: string; question: string }
  | { type: 'answerReady'; id: string; result: AskResult }
  | { type: 'answerFailed'; id: string; code: ApiErrorCode }
  | { type: 'compareDocumentParsed'; document: ParsedDocument }
  | { type: 'compareStarted' }
  | { type: 'compareReady'; compare: CompareResult }
  | { type: 'compareFailed'; code: ApiErrorCode }
  | { type: 'prepareStarted' }
  | { type: 'prepareReady'; prepare: PrepareResult }
  | { type: 'prepareFailed'; code: ApiErrorCode }
  | { type: 'clauseFocused'; clauseId: string | null }
  | { type: 'clearEverything' };

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'sessionReady':
      return { ...state, session: action.session, sessionStatus: 'ready' };

    case 'sessionFailed':
      return { ...state, sessionStatus: 'failed' };

    case 'sessionExpired':
      // The server refused the token: it lapsed after thirty minutes, or the reader's network
      // changed. Dropping it makes the session gate run the check again in the background,
      // instead of the reader reloading and losing their document.
      return { ...state, session: null, sessionStatus: 'pending' };

    case 'documentParsed':
      // A new document invalidates everything derived from the old one, so the reducer resets
      // rather than leaving a previous report on screen beside new clauses.
      return {
        ...initialState,
        session: state.session,
        sessionStatus: state.sessionStatus,
        lenses: state.lenses,
        document: action.document,
        stage: 'lenses',
      };

    case 'lensesChosen':
      return { ...state, lenses: action.lenses };

    case 'analysisStarted':
      return { ...state, stage: 'report', analysisStatus: 'loading', analysis: null };

    case 'analysisReady':
      return { ...state, analysisStatus: 'ready', analysis: action.analysis };

    case 'analysisFailed':
      return { ...state, analysisStatus: 'error', analysisError: action.code };

    case 'questionAsked':
      return {
        ...state,
        qa: [
          ...state.qa,
          { id: action.id, question: action.question, result: null, status: 'loading' },
        ],
      };

    case 'answerReady':
      return {
        ...state,
        qa: state.qa.map((entry) =>
          entry.id === action.id ? { ...entry, result: action.result, status: 'ready' } : entry,
        ),
      };

    case 'answerFailed':
      return {
        ...state,
        qa: state.qa.map((entry) =>
          entry.id === action.id ? { ...entry, status: 'error', errorCode: action.code } : entry,
        ),
      };

    case 'compareDocumentParsed':
      return { ...state, compareDocument: action.document, compare: null, compareStatus: 'idle' };

    case 'compareStarted':
      return { ...state, compareStatus: 'loading', compare: null };

    case 'compareReady':
      return { ...state, compareStatus: 'ready', compare: action.compare };

    case 'compareFailed':
      return { ...state, compareStatus: 'error', compareError: action.code };

    case 'prepareStarted':
      return { ...state, prepareStatus: 'loading', prepare: null };

    case 'prepareReady':
      return { ...state, prepareStatus: 'ready', prepare: action.prepare };

    case 'prepareFailed':
      return { ...state, prepareStatus: 'error', prepareError: action.code };

    case 'clauseFocused':
      return { ...state, focusedClauseId: action.clauseId };

    case 'clearEverything':
      // Keeps the session token: the user is clearing their document, not asking to re-solve a
      // challenge. Everything derived from the document goes.
      return { ...initialState, session: state.session, sessionStatus: state.sessionStatus };
  }
}

interface AppStateValue {
  state: AppState;
  dispatch: Dispatch<AppAction>;
  /** Clause lookup by id, memoised because the report renders it on every citation. */
  clauseById: (id: string) => ParsedDocument['clauses'][number] | undefined;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({
  children,
  initial = initialState,
}: {
  children: ReactNode;
  initial?: AppState;
}) {
  const [state, dispatch] = useReducer(appReducer, initial);

  const index = useMemo(
    () => new Map((state.document?.clauses ?? []).map((clause) => [clause.id, clause])),
    [state.document],
  );

  const clauseById = useCallback((id: string) => index.get(id), [index]);

  const value = useMemo<AppStateValue>(
    () => ({ state, dispatch, clauseById }),
    [state, clauseById],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside <AppStateProvider>');
  return value;
}
