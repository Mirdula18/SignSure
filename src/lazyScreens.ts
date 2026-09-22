import { lazy } from 'react';
import { LoadFailed } from '@/components/LoadFailed';

/**
 * Screens loaded on demand.
 *
 * The report and its five tabs are most of the app's code, and nobody needs them on the first
 * screen. Splitting them out takes them off the critical path of the page most visitors on a
 * phone will ever see. `App` prefetches the report once a document is loaded, so by the time
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
