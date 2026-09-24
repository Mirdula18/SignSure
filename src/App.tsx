import { Suspense, useCallback, useEffect, useRef } from 'react';
import type { Lens } from '@shared/lenses';
import { AppFooter } from '@/components/AppFooter';
import { AppHeader } from '@/components/AppHeader';
import { DisclaimerBanner } from '@/components/DisclaimerBanner';
import { SkipLink } from '@/components/SkipLink';
import { Button } from '@/components/Button';
import { focusHeadingWhenReady } from '@/components/focusHeading';
import { LensPicker } from '@/features/lenses/LensPicker';
import { SessionGate } from '@/features/session/SessionGate';
import { UploadScreen } from '@/features/upload/UploadScreen';
import { LazyReportScreen, prefetchWhenIdle } from '@/lazyScreens';
import { useAppState } from '@/state/appState';
import { useT } from '@/state/preferences';

/**
 * Three screens, chosen by a single `stage` in the reducer: add a document, say what you are
 * worried about, read the report. There is no router, because there is no URL worth sharing -
 * the whole point is that nothing about the document persists anywhere.
 */
export default function App() {
  const t = useT();
  const { state, dispatch } = useAppState();

  const onAnalyse = useCallback(
    (lenses: Lens[]) => {
      dispatch({ type: 'lensesChosen', lenses });
      dispatch({ type: 'analysisStarted' });
    },
    [dispatch],
  );

  // Fetch the report's code in idle time, so it is there before Analyse is pressed.
  useEffect(prefetchWhenIdle, []);

  // The button that moves to a new screen is gone once it has, so focus goes to the new
  // screen's heading instead of falling back to the page body. Not on first load: the skip link
  // must stay the first stop.
  const mainRef = useRef<HTMLElement>(null);
  const shownStage = useRef(state.stage);
  useEffect(() => {
    if (shownStage.current === state.stage) return;
    shownStage.current = state.stage;
    return focusHeadingWhenReady(mainRef.current);
  }, [state.stage]);

  // Mounted for the life of the page, so the announcement survives the loading view being
  // replaced by the report. Focus stays where the reader left it (WCAG 3.2.5).
  const announcement =
    state.stage === 'report' && state.analysisStatus === 'ready' ? t('report.ready') : '';

  return (
    <>
      <SkipLink />
      <AppHeader />
      <DisclaimerBanner />

      <main
        ref={mainRef}
        id="main"
        tabIndex={-1}
        className="mx-auto max-w-5xl px-4 py-8 focus-visible:outline-none"
      >
        {state.stage === 'upload' ? (
          <>
            <div className="mb-10">
              <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
                {t('home.heading')}
              </h1>
              <p className="prose-measure mt-3 text-base text-muted">{t('home.intro')}</p>

              <ul className="mt-6 grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ['home.trust1Title', 'home.trust1Body'],
                    ['home.trust2Title', 'home.trust2Body'],
                    ['home.trust3Title', 'home.trust3Body'],
                  ] as const
                ).map(([title, body]) => (
                  <li key={title} className="rounded-xl border border-line bg-raised p-4">
                    <h2 className="text-sm font-semibold text-ink">{t(title)}</h2>
                    <p className="mt-1 text-sm text-muted">{t(body)}</p>
                  </li>
                ))}
              </ul>
            </div>
            <UploadScreen />
          </>
        ) : null}

        {state.stage === 'lenses' ? (
          <>
            <p className="mb-6 text-sm text-muted">
              {state.document?.pageCount === null || state.document === null
                ? t('upload.parsedNoPages', { clauses: state.document?.clauses.length ?? 0 })
                : t('upload.parsedPages', {
                    clauses: state.document.clauses.length,
                    pages: state.document.pageCount ?? 0,
                  })}
            </p>
            <LensPicker
              initial={state.lenses}
              onSubmit={onAnalyse}
              onBack={() => {
                dispatch({ type: 'clearEverything' });
              }}
            />
          </>
        ) : null}

        {state.stage === 'report' ? (
          <Suspense
            fallback={
              <p role="status" className="text-sm text-muted">
                {t('report.loading')}
              </p>
            }
          >
            <LazyReportScreen />
          </Suspense>
        ) : null}

        {/* One fixed slot, so the security check survives the move from concerns to report. */}
        {state.document !== null && state.session === null ? (
          <div className="no-print mt-6">
            <SessionGate />
          </div>
        ) : null}

        {state.stage !== 'upload' ? (
          <p className="no-print mt-10 text-xs text-muted">
            {t('app.startOverHint')}{' '}
            <Button
              variant="ghost"
              className="px-1 underline"
              onClick={() => {
                dispatch({ type: 'clearEverything' });
              }}
            >
              {t('app.startOver')}
            </Button>
          </p>
        ) : null}

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </main>

      <AppFooter />
    </>
  );
}
