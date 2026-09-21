import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import type { AnalysisResult, Clause, ClauseFinding, ParsedDocument, RuleHit } from '@shared/types';
import { AppStateProvider, initialState, type AppState } from '@/state/appState';
import { PreferencesProvider } from '@/state/preferences';

/**
 * Builders for component tests.
 *
 * Each returns a complete, valid object with sensible defaults, so a test states only the one or
 * two fields it is actually about. That keeps the intent of each test visible instead of buried
 * in forty lines of fixture.
 */

export function clause(overrides: Partial<Clause> = {}): Clause {
  return {
    id: 'c001',
    label: '6.1',
    heading: null,
    text: 'The Employee shall give ninety (90) days written notice of resignation to the Company.',
    page: 2,
    pageEnd: 2,
    order: 0,
    ...overrides,
  };
}

export function finding(overrides: Partial<ClauseFinding> = {}): ClauseFinding {
  return {
    clauseId: 'c001',
    category: 'NOTICE_PERIOD',
    risk: 'HIGH',
    title: 'Notice you must give',
    explanation: 'You must give ninety days notice before you leave.',
    whyItMatters: 'A long notice period can delay a new job.',
    evidence: {
      clauseId: 'c001',
      quote: 'ninety (90) days written notice',
      status: 'verified',
      start: 24,
      end: 55,
    },
    questionsToAsk: ['Can I buy out my notice period?'],
    modelConfidence: 'high',
    ...overrides,
  };
}

export function ruleHit(overrides: Partial<RuleHit> = {}): RuleHit {
  return {
    ruleId: 'IN-EMP-NOTICE-LONG',
    clauseId: 'c001',
    severity: 'HIGH',
    title: 'Long notice period',
    message: 'A long notice period can make it harder to join a new employer quickly.',
    basis: 'Contract terms.',
    questions: ['Is notice buyout allowed?'],
    lastReviewed: '2026-09-20',
    details: { period: 'ninety (90) days' },
    ...overrides,
  };
}

export function analysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    documentSummary: {
      documentType: 'Letter of appointment',
      employer: 'Nimbus Technologies Private Limited',
      role: null,
      startDate: '20 October 2026',
      noticePeriod: 'ninety (90) days',
      probation: null,
      bondOrPenalty: null,
      overview: 'This is an offer of employment.',
      sourceClauseIds: ['c001'],
    },
    findings: [finding()],
    ruleHits: [ruleHit()],
    missingInfo: [
      {
        ruleId: 'IN-EMP-MISSING-LEAVE',
        label: 'Leave entitlement',
        question: 'How many paid leaves?',
      },
    ],
    stats: { verified: 1, fuzzy: 0, unverified: 0 },
    ...overrides,
  };
}

export function parsedDocument(clauses: Clause[] = [clause()]): ParsedDocument {
  return {
    clauses,
    pageCount: 3,
    charCount: clauses.reduce((sum, item) => sum + item.text.length, 0),
    source: 'sample',
    fileName: null,
  };
}

/**
 * Renders inside both providers, optionally starting from a prepared app state.
 *
 * Uses RTL's `wrapper` option rather than wrapping the element, so `rerender` keeps the
 * providers - wrapping by hand silently drops them on the second render.
 */
export function renderWithProviders(ui: ReactElement, state: Partial<AppState> = {}): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <PreferencesProvider>
        <AppStateProvider initial={{ ...initialState, ...state }}>{children}</AppStateProvider>
      </PreferencesProvider>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

/** Renders with only the preferences provider, for components that do not touch app state. */
export function renderWithPreferences(ui: ReactElement): RenderResult {
  return render(ui, { wrapper: PreferencesProvider });
}
