import { lazy } from 'react';
import { LoadFailed } from '@/components/LoadFailed';

/**
 * Screens loaded on demand.
 *
 * The report and its five tabs are most of the app's code, and nobody needs them on the first
 * screen. Splitting them out takes them off the critical path of the page most visitors on a
 * phone will ever see. `App` prefetches the report when the browser is idle, so by the time
 * Analyse is pressed it has usually arrived.
 */

/** Resolves to the report screen, or to an explanation with a reload button if it cannot load. */
export function loadReportScreen() {
  return import('@/features/report/ReportScreen').then(
    (module) => ({ default: module.ReportScreen }),
    () => ({ default: LoadFailed }),
  );
}

export const LazyReportScreen = lazy(loadReportScreen);

/** Long enough that the first screen has painted and settled on a slow phone. */
const IDLE_FALLBACK_MS = 1_500;

/**
 * Fetches the code the next screens need once the browser has nothing better to do.
 *
 * The report, the response schemas, the text parser and the sample letter are small (about 50 kB
 * gzip together) and nearly every reader needs them, so they are warmed in idle time rather than
 * on the critical path or at the moment a button is pressed. The PDF and Word readers are not:
 * they are most of the app's bytes and only someone uploading that kind of file needs them.
 *
 * Returns a cancel function, so it can be used directly as an effect.
 */
export function prefetchWhenIdle(): () => void {
  const run = () => {
    void loadReportScreen();
    // A failure here only means the chunk is fetched again on first use.
    const ignore = () => undefined;
    import('@shared/schemas').catch(ignore);
    import('@/features/parsing/parseDocument').catch(ignore);
    import('@/sample/offerLetter').catch(ignore);
  };
  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: IDLE_FALLBACK_MS * 2 });
    return () => {
      window.cancelIdleCallback(handle);
    };
  }
  // Safari has no requestIdleCallback.
  const handle = window.setTimeout(run, IDLE_FALLBACK_MS);
  return () => {
    window.clearTimeout(handle);
  };
}
