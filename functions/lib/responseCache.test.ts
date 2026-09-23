import { describe, expect, it, vi } from 'vitest';
import { cacheKey, ResponseCache } from './responseCache';

const always = () => true;

function cacheAt(start = 0, options: { maxEntries?: number; ttlMs?: number } = {}) {
  let now = start;
  const cache = new ResponseCache<string>({
    maxEntries: options.maxEntries ?? 4,
    ttlMs: options.ttlMs ?? 1000,
    now: () => now,
  });
  return {
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ResponseCache', () => {
  it('loads once and answers a repeat from memory', async () => {
    const { cache } = cacheAt();
    const load = vi.fn(() => Promise.resolve('answer'));

    expect(await cache.getOrLoad('k', load, always)).toBe('answer');
    expect(await cache.getOrLoad('k', load, always)).toBe('answer');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between identical requests that arrive together', async () => {
    const { cache } = cacheAt();
    let resolve: (value: string) => void = () => undefined;
    const load = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );

    const first = cache.getOrLoad('k', load, always);
    const second = cache.getOrLoad('k', load, always);
    resolve('answer');

    expect(await Promise.all([first, second])).toEqual(['answer', 'answer']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads again once an entry has expired', async () => {
    const { cache, advance } = cacheAt(0, { ttlMs: 1000 });
    const load = vi.fn(() => Promise.resolve('answer'));

    await cache.getOrLoad('k', load, always);
    advance(1000);
    await cache.getOrLoad('k', load, always);

    expect(load).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
  });

  it('does not keep a value the caller rejects, so a failure is never replayed', async () => {
    const { cache } = cacheAt();
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('failure')
      .mockResolvedValueOnce('answer');
    const keep = (value: string) => value !== 'failure';

    expect(await cache.getOrLoad('k', load, keep)).toBe('failure');
    expect(await cache.getOrLoad('k', load, keep)).toBe('answer');
    expect(await cache.getOrLoad('k', load, keep)).toBe('answer');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets a load that throws, and rethrows its error', async () => {
    const { cache } = cacheAt();
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('answer');

    await expect(cache.getOrLoad('k', load, always)).rejects.toThrow('boom');
    expect(cache.size).toBe(0);
    expect(await cache.getOrLoad('k', load, always)).toBe('answer');
  });

  it('keeps a newer load when an older one for the same key fails late', async () => {
    const { cache, advance } = cacheAt(0, { ttlMs: 1000 });
    let fail: (error: Error) => void = () => undefined;
    const slow = cache.getOrLoad(
      'k',
      () =>
        new Promise<string>((_, reject) => {
          fail = reject;
        }),
      always,
    );

    // The slow entry expires and a fresh load replaces it before the slow one fails.
    advance(1000);
    await cache.getOrLoad('k', () => Promise.resolve('fresh'), always);
    fail(new Error('late'));
    await expect(slow).rejects.toThrow('late');

    const load = vi.fn(() => Promise.resolve('unused'));
    expect(await cache.getOrLoad('k', load, always)).toBe('fresh');
    expect(load).not.toHaveBeenCalled();
  });

  it('evicts the least recently used entry once full', async () => {
    const { cache } = cacheAt(0, { maxEntries: 2 });
    const value = (text: string) => () => Promise.resolve(text);

    await cache.getOrLoad('a', value('A'), always);
    await cache.getOrLoad('b', value('B'), always);
    // Reading "a" makes "b" the oldest, so "b" is the one a third key pushes out.
    await cache.getOrLoad('a', value('unused'), always);
    await cache.getOrLoad('c', value('C'), always);

    expect(cache.size).toBe(2);
    const reload = vi.fn(() => Promise.resolve('B again'));
    expect(await cache.getOrLoad('b', reload, always)).toBe('B again');
    expect(await cache.getOrLoad('c', value('unused'), always)).toBe('C');
  });

  it('empties on clear', async () => {
    const { cache } = cacheAt();
    await cache.getOrLoad('k', () => Promise.resolve('answer'), always);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('uses the real clock when none is injected', async () => {
    const cache = new ResponseCache<string>({ maxEntries: 1, ttlMs: 60_000 });
    const load = vi.fn(() => Promise.resolve('answer'));
    await cache.getOrLoad('k', load, always);
    await cache.getOrLoad('k', load, always);
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('cacheKey', () => {
  it('is a SHA-256 hex digest, so no request text is held as a key', async () => {
    const key = await cacheKey({ prompt: 'Either party may give thirty days notice.' });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain('notice');
  });

  it('is stable for equal requests and differs for different ones', async () => {
    expect(await cacheKey({ a: 1 })).toBe(await cacheKey({ a: 1 }));
    expect(await cacheKey({ a: 1 })).not.toBe(await cacheKey({ a: 2 }));
  });
});
