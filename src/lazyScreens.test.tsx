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

describe('prefetchWhenIdle', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock('@/features/report/ReportScreen');
    vi.resetModules();
  });

  /** Replaces the report module with one that records when its code is fetched. */
  async function withTrackedReport() {
    const fetched = vi.fn();
    vi.doMock('@/features/report/ReportScreen', () => {
      fetched();
      return { ReportScreen: () => null };
    });
    vi.resetModules();
    const { prefetchWhenIdle } = await import('./lazyScreens');
    return { fetched, prefetchWhenIdle };
  }

  it('waits for the browser to be idle, then fetches the report', async () => {
    let idle: IdleRequestCallback = () => undefined;
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idle = callback;
      return 7;
    });
    vi.stubGlobal('requestIdleCallback', requestIdleCallback);
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    const { fetched, prefetchWhenIdle } = await withTrackedReport();

    prefetchWhenIdle();
    expect(requestIdleCallback).toHaveBeenCalledTimes(1);
    expect(fetched).not.toHaveBeenCalled();

    idle({ didTimeout: false, timeRemaining: () => 50 });
    await vi.waitFor(() => {
      expect(fetched).toHaveBeenCalledTimes(1);
    });
  });

  it('shrugs off a schema chunk that fails to load, since it is fetched again on first use', async () => {
    let idle: IdleRequestCallback = () => undefined;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: IdleRequestCallback) => {
        idle = callback;
        return 1;
      }),
    );
    vi.doMock('@shared/schemas', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const { fetched, prefetchWhenIdle } = await withTrackedReport();

    prefetchWhenIdle();
    idle({ didTimeout: false, timeRemaining: () => 50 });
    // Vitest fails the run on an unhandled rejection, so reaching the end is the assertion.
    await vi.waitFor(() => {
      expect(fetched).toHaveBeenCalledTimes(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    vi.doUnmock('@shared/schemas');
  });

  it('cancels the idle request when the page is torn down first', async () => {
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn(() => 7),
    );
    vi.stubGlobal('cancelIdleCallback', cancelIdleCallback);
    const { prefetchWhenIdle } = await withTrackedReport();

    prefetchWhenIdle()();
    expect(cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('falls back to a short timer where requestIdleCallback does not exist', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fetched, prefetchWhenIdle } = await withTrackedReport();

    prefetchWhenIdle();
    expect(fetched).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_500);
    vi.useRealTimers();
    await vi.waitFor(() => {
      expect(fetched).toHaveBeenCalledTimes(1);
    });
  });

  it('clears the fallback timer when cancelled, so nothing is fetched', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fetched, prefetchWhenIdle } = await withTrackedReport();

    prefetchWhenIdle()();
    vi.advanceTimersByTime(5_000);
    expect(fetched).not.toHaveBeenCalled();
  });
});
