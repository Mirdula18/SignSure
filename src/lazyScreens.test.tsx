import { afterEach, describe, expect, it, vi } from 'vitest';

describe('loadReportScreen', () => {
  afterEach(() => {
    vi.doUnmock('@/features/report/ReportScreen');
    vi.resetModules();
  });

  it('resolves to the report screen when its code loads', async () => {
    const { loadReportScreen } = await import('./lazyScreens');
    const { ReportScreen } = await import('@/features/report/ReportScreen');
    expect((await loadReportScreen()).default).toBe(ReportScreen);
  });

  it('resolves to a reload prompt, not a crash, when its code cannot be fetched', async () => {
    // What a stale page sees after a deploy: the old chunk no longer exists.
    vi.doMock('@/features/report/ReportScreen', () => {
      throw new Error('Failed to fetch dynamically imported module');
    });
    vi.resetModules();
    const { loadReportScreen } = await import('./lazyScreens');
    const { LoadFailed } = await import('@/components/LoadFailed');
    expect((await loadReportScreen()).default).toBe(LoadFailed);
  });
});
