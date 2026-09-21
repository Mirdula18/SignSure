import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import type { Clause } from '@shared/types';
import { Button } from '@/components/Button';
import { Tabs, type TabDefinition } from '@/components/Tabs';
import { AskPanel } from '@/features/ask/AskPanel';
import { CompareTab } from '@/features/compare/CompareTab';
import { PrepareSheet } from '@/features/prepare/PrepareSheet';
import { useAppState } from '@/state/appState';
import { usePreferences, useT } from '@/state/preferences';
import {
  analyzeDocument,
  askQuestion,
  compareDocuments,
  preparePack,
  ApiError,
} from '@/api/client';
import type { TranslationKey } from '@/i18n';
import { ClauseList } from './ClauseList';
import { Overview } from './Overview';

/**
 * The report, and the place every network call is made from.
 *
 * Keeping the calls here rather than inside each tab means a tab is a pure view of state it was
 * handed, which is what makes them straightforward to test. Progress is announced through a
 * polite live region and focus is never moved on completion (WCAG 3.2.5): the reader is told
 * the report is ready and decides for themselves when to go to it.
 */

type TabId = 'overview' | 'clauses' | 'ask' | 'compare' | 'prepare';

function errorKeyFor(code: string | undefined): TranslationKey {
  return `error.${code ?? 'INTERNAL'}` as TranslationKey;
}

export function ReportScreen() {
  const t = useT();
  const { language, readingLevel } = usePreferences();
  const { state, dispatch, clauseById } = useAppState();
  const [tab, setTab] = useState<TabId>('overview');
  const statusId = useId();

  // Memoised because several callbacks depend on it; without this the empty-array fallback
  // would be a new reference on every render and recreate all of them.
  const clauses = useMemo(() => state.document?.clauses ?? [], [state.document]);
  const token = state.session?.token ?? null;

  /* -------------------------------- analyse -------------------------------- */

  const { analysisStatus, document: parsedDocument, lenses, sessionStatus } = state;

  useEffect(() => {
    // Read the clauses from state inside the effect rather than closing over the array derived
    // during render: that array is a new reference every render and would restart the request.
    const documentClauses = parsedDocument?.clauses;
    if (analysisStatus !== 'loading') return;

    // A reader can reach "Analyse" before the security check has finished, so a missing token
    // is only an error once that check has actually failed. While it is still pending, do
    // nothing: this effect runs again as soon as the session lands.
    if (token === null) {
      if (sessionStatus === 'failed') {
        dispatch({ type: 'analysisFailed', code: 'UNAUTHORIZED' });
      }
      return;
    }
    if (!documentClauses?.length) {
      dispatch({ type: 'analysisFailed', code: 'INVALID_INPUT' });
      return;
    }

    const controller = new AbortController();
    analyzeDocument(
      token,
      { clauses: documentClauses, lenses, language, readingLevel },
      { signal: controller.signal },
    )
      .then((analysis) => {
        dispatch({ type: 'analysisReady', analysis });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        dispatch({
          type: 'analysisFailed',
          code: error instanceof ApiError ? error.code : 'INTERNAL',
        });
      });

    return () => {
      controller.abort();
    };
  }, [
    analysisStatus,
    parsedDocument,
    lenses,
    token,
    sessionStatus,
    language,
    readingLevel,
    dispatch,
  ]);

  const retry = useCallback(() => {
    dispatch({ type: 'analysisStarted' });
  }, [dispatch]);

  /* ---------------------------------- ask ---------------------------------- */

  const onAsk = useCallback(
    (question: string) => {
      if (token === null) return;
      const id = crypto.randomUUID();
      dispatch({ type: 'questionAsked', id, question });

      const history = state.qa
        .filter((entry) => entry.result !== null)
        .slice(-2)
        .map((entry) => ({ question: entry.question, answer: entry.result?.answer ?? '' }));

      askQuestion(token, { clauses, question, history, language, readingLevel })
        .then((result) => {
          dispatch({ type: 'answerReady', id, result });
        })
        .catch((error: unknown) => {
          dispatch({
            type: 'answerFailed',
            id,
            code: error instanceof ApiError ? error.code : 'INTERNAL',
          });
        });
    },
    [clauses, dispatch, language, readingLevel, state.qa, token],
  );

  const onCitationFollowed = useCallback(
    (clauseId: string) => {
      dispatch({ type: 'clauseFocused', clauseId });
      setTab('clauses');
    },
    [dispatch],
  );

  // Moving focus to the clause is a direct consequence of the reader clicking a citation, so it
  // is expected rather than disorienting - unlike focus moving when an async call finishes.
  useEffect(() => {
    if (state.focusedClauseId === null || tab !== 'clauses') return;
    const target = document.getElementById(`clause-${state.focusedClauseId}`);
    target?.focus({ preventScroll: false });
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [state.focusedClauseId, tab]);

  /* -------------------------------- compare -------------------------------- */

  const [compareClauses, setCompareClauses] = useState<Clause[] | null>(null);

  const onCompare = useCallback(() => {
    if (token === null || compareClauses === null) return;
    dispatch({ type: 'compareStarted' });
    compareDocuments(token, { clausesA: clauses, clausesB: compareClauses, language, readingLevel })
      .then((compare) => {
        dispatch({ type: 'compareReady', compare });
      })
      .catch((error: unknown) => {
        dispatch({
          type: 'compareFailed',
          code: error instanceof ApiError ? error.code : 'INTERNAL',
        });
      });
  }, [clauses, compareClauses, dispatch, language, readingLevel, token]);

  /* -------------------------------- prepare -------------------------------- */

  const onPrepare = useCallback(() => {
    if (token === null || state.analysis === null) return;
    dispatch({ type: 'prepareStarted' });
    preparePack(token, {
      clauses,
      lenses: state.lenses,
      language,
      readingLevel,
      findings: state.analysis.findings.map((finding) => ({
        clauseId: finding.clauseId,
        category: finding.category,
        risk: finding.risk,
        title: finding.title,
      })),
      unansweredQuestions: state.qa
        .filter((entry) => entry.result?.status === 'not_in_document')
        .map((entry) => entry.question),
    })
      .then((prepare) => {
        dispatch({ type: 'prepareReady', prepare });
      })
      .catch((error: unknown) => {
        dispatch({
          type: 'prepareFailed',
          code: error instanceof ApiError ? error.code : 'INTERNAL',
        });
      });
  }, [clauses, dispatch, language, readingLevel, state.analysis, state.lenses, state.qa, token]);

  /* --------------------------------- render -------------------------------- */

  const analysis = state.analysis;
  const redFlagCount =
    analysis?.findings.filter(
      (finding) => finding.risk === 'HIGH' && finding.evidence.status !== 'unverified',
    ).length ?? 0;

  const tabs: TabDefinition<TabId>[] = [
    {
      id: 'overview',
      label: t('report.tab.overview'),
      badge: redFlagCount,
      badgeLabel: t('report.highRiskCount', { count: redFlagCount }),
    },
    { id: 'clauses', label: t('report.tab.clauses') },
    { id: 'ask', label: t('report.tab.ask') },
    { id: 'compare', label: t('report.tab.compare') },
    { id: 'prepare', label: t('report.tab.prepare') },
  ];

  if (state.analysisStatus === 'loading') {
    return (
      <section aria-labelledby="report-heading" aria-busy="true" className="flex flex-col gap-4">
        <h1 id="report-heading" className="text-2xl font-semibold text-ink">
          {t('report.heading')}
        </h1>
        <p id={statusId} aria-live="polite" className="text-sm text-muted">
          {t('report.loading')}
        </p>
        <div className="flex flex-col gap-3" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-raised" />
          ))}
        </div>
      </section>
    );
  }

  if (state.analysisStatus === 'error' || analysis === null) {
    return (
      <section aria-labelledby="report-heading" className="flex flex-col gap-4">
        <h1 id="report-heading" className="text-2xl font-semibold text-ink">
          {t('report.heading')}
        </h1>
        <div role="alert" className="rounded-lg border border-high bg-high-soft p-4">
          <p className="font-semibold text-high">{t('error.heading')}</p>
          <p className="mt-1 text-sm text-ink">{t(errorKeyFor(state.analysisError))}</p>
        </div>
        <div>
          <Button variant="primary" onClick={retry}>
            {t('report.retry')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="report-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="report-heading" className="text-2xl font-semibold text-ink">
          {t('report.heading')}
        </h1>
        <Button
          variant="danger"
          className="no-print"
          onClick={() => {
            dispatch({ type: 'clearEverything' });
          }}
        >
          {t('app.startOver')}
        </Button>
      </div>

      <Tabs tabs={tabs} selected={tab} onSelect={setTab} label={t('report.tabsLabel')}>
        {tab === 'overview' ? <Overview analysis={analysis} clauseById={clauseById} /> : null}

        {tab === 'clauses' ? (
          <ClauseList
            analysis={analysis}
            clauses={clauses}
            focusedClauseId={state.focusedClauseId}
          />
        ) : null}

        {tab === 'ask' ? (
          <AskPanel clauses={clauses} onAsk={onAsk} onCitationFollowed={onCitationFollowed} />
        ) : null}

        {tab === 'compare' ? (
          <CompareTab
            result={state.compare}
            status={state.compareStatus}
            errorKey={state.compareError === undefined ? null : errorKeyFor(state.compareError)}
            clausesA={clauses}
            hasSecondDocument={compareClauses !== null}
            onSecondDocument={setCompareClauses}
            onCompare={onCompare}
          />
        ) : null}

        {tab === 'prepare' ? (
          state.prepare === null ? (
            <div className="flex flex-col gap-4">
              <p className="prose-measure text-sm text-muted">{t('prepare.intro')}</p>
              <div>
                <Button
                  variant="primary"
                  disabled={state.prepareStatus === 'loading'}
                  onClick={onPrepare}
                >
                  {t('prepare.build')}
                </Button>
              </div>
              <p aria-live="polite" className="min-h-5 text-sm text-muted">
                {state.prepareStatus === 'loading' ? t('prepare.building') : ''}
              </p>
              {state.prepareStatus === 'error' ? (
                <p role="alert" className="text-sm text-high">
                  {t(errorKeyFor(state.prepareError))}
                </p>
              ) : null}
            </div>
          ) : (
            <PrepareSheet
              sheet={state.prepare}
              documentName={state.document?.fileName ?? null}
              flagged={analysis.findings
                .filter((finding) => finding.risk === 'HIGH')
                .map((finding) => ({
                  label: clauseById(finding.clauseId)?.label ?? finding.clauseId,
                  risk: finding.risk,
                  title: finding.title,
                  text: clauseById(finding.clauseId)?.text ?? '',
                }))}
            />
          )
        ) : null}
      </Tabs>
    </section>
  );
}
